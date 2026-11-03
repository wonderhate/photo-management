"""Build a resumable, partitioned China-area WorldCover 10 m offline map set.

No imagery is bundled with the app. Country polygons select download cells only;
they are not drawn as boundaries or used to clip imagery. Small-island and border
coverage windows supplement the coarse selection. Only public ESA COGs are read.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack
import hashlib
import io
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# These build tools use elementwise NumPy operations, not threaded BLAS.
# Scope the limit to this map process and its children, before NumPy loads.
for _name in ('OPENBLAS_NUM_THREADS', 'OPENBLAS_DEFAULT_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[_name] = '1'

import numpy as np
import requests
from PIL import Image
from pmtiles.reader import Reader, all_tiles
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from rasterio.features import rasterize
from rasterio.transform import from_origin

COUNTRIES = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson'
BUCKET = 'https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/'
DATA_REFERENCE = 'https://registry.opendata.aws/esa-worldcover-vito-composites/'
SUPPLEMENTS = [
    ('southern-island-coverage', [109, 3, 118, 18]),
    ('dongsha-coverage', [116, 20, 118, 22]),
    ('eastern-island-coverage', [122, 24, 125, 27]),
    ('western-border-buffer', [78, 34, 81, 37]),
    ('southwestern-border-buffer', [91, 27, 97, 30]),
]
CHECKPOINTS = {
    'Beijing': [116.4, 39.9], 'Shanghai': [121.47, 31.23], 'Guilin': [110.3, 25.27],
    'Urumqi': [87.62, 43.82], 'Lhasa': [91.13, 29.65], 'Mohe': [122.54, 52.97],
    'Hong Kong': [114.17, 22.3], 'Macao': [113.55, 22.2], 'Taipei': [121.56, 25.03],
    'Sanya': [109.51, 18.25], 'Yongxing': [112.34, 16.83], 'Yongshu': [112.97, 9.55],
}


def atomic_json(path, value):
    partial = path.with_suffix(path.suffix + '.tmp')
    partial.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    # Windows readers/antivirus can briefly hold the destination without
    # delete sharing. Keep the old valid JSON until replacement succeeds.
    for attempt in range(20):
        try:
            partial.replace(path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(min(0.05 * (attempt + 1), 0.25))


def fetch(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def source_key(lon, lat):
    return f'rgbnir/2021/N{lat:02d}/ESA_WorldCover_10m_2021_v200_N{lat:02d}E{lon:03d}_S2RGBNIR.tif'


def catalog_row(lat):
    result, token = {}, ''
    while True:
        query = {'list-type': '2', 'prefix': f'rgbnir/2021/N{lat:02d}/'}
        if token:
            query['continuation-token'] = token
        document = ET.fromstring(fetch(BUCKET + '?' + urllib.parse.urlencode(query)))
        ns = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
        for item in document.findall('s:Contents', ns):
            key = item.findtext('s:Key', namespaces=ns)
            result[key] = {'bytes': int(item.findtext('s:Size', namespaces=ns)), 'etag': item.findtext('s:ETag', namespaces=ns).strip('"')}
        token = document.findtext('s:NextContinuationToken', default='', namespaces=ns)
        if not token:
            return result


def plan(root):
    root.mkdir(parents=True, exist_ok=True)
    country_file = root / 'source-countries.geojson'
    if not country_file.exists():
        country_file.write_bytes(fetch(COUNTRIES))
    country_bytes = country_file.read_bytes()
    features = json.loads(country_bytes)['features']
    selected = [f['geometry'] for f in features if f['properties'].get('ADM0_A3') in ('CHN', 'HKG', 'MAC', 'TWN')]
    if len(selected) != 4:
        raise ValueError('Coverage reference is incomplete')
    # One degree cells, matching the official RGBNIR source grid. No territorial
    # lines are rendered; edge cells deliberately include adjoining landscapes.
    mask = rasterize([(g, 1) for g in selected], out_shape=(51, 63), transform=from_origin(73, 54, 1, 1), all_touched=True)
    wanted = {(73 + int(col), 53 - int(row)) for row, col in np.argwhere(mask)}
    for _, (west, south, east, north) in SUPPLEMENTS:
        wanted.update((lon, lat) for lat in range(south, north) for lon in range(west, east))
    catalog_path = root / 'source-catalog.json'
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    else:
        catalog = {}
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = {pool.submit(catalog_row, lat): lat for lat in sorted({lat for _, lat in wanted})}
            for job in as_completed(jobs):
                catalog.update(job.result())
                print(f'Catalog latitude {jobs[job]} complete', flush=True)
        atomic_json(catalog_path, catalog)
    cells, unavailable, groups = [], [], {}
    for lon, lat in sorted(wanted, key=lambda point: (point[1], point[0])):
        key = source_key(lon, lat)
        if key not in catalog:
            unavailable.append({'lon': lon, 'lat': lat, 'reason': 'No source object in the ESA RGBNIR catalog'})
            continue
        region = f'E{lon // 5 * 5:03d}-N{lat // 5 * 5:02d}'
        cell = {'id': f'N{lat:02d}E{lon:03d}', 'bbox': [lon, lat, lon + 1, lat + 1], 'region': region, 'url': BUCKET + key, **catalog[key]}
        cells.append(cell); groups.setdefault(region, []).append(cell['id'])
    available = {(c['bbox'][0], c['bbox'][1]) for c in cells}
    checks = {name: (math.floor(lon), math.floor(lat)) in available for name, (lon, lat) in CHECKPOINTS.items()}
    if not all(value for name, value in checks.items() if name != 'Yongshu'):
        raise ValueError(f'Missing required coverage checkpoint: {checks}')
    result = {'version': 1, 'year': 2021, 'resolution': '10 m', 'min_zoom': 6, 'max_zoom': 14,
              'source_reference': DATA_REFERENCE, 'license': 'CC BY 4.0',
              'coverage_reference': {'url': COUNTRIES, 'sha256': hashlib.sha256(country_bytes).hexdigest(), 'license': 'Public domain', 'supplemental_windows': SUPPLEMENTS},
              'coverage_note': 'Geographic download coverage only, not an administrative boundary map. Border cells include adjoining areas. Unavailable ocean cells fall back to the global overview.',
              'cells': cells, 'groups': groups, 'unavailable_cells': unavailable, 'coverage_checks': checks,
              'coverage_gaps': [name for name, present in checks.items() if not present],
              'complete_source_bytes': sum(c['bytes'] for c in cells)}
    atomic_json(root / 'plan.json', result)
    print(json.dumps({'cells': len(cells), 'packs': len(groups), 'source_GiB': round(result['complete_source_bytes'] / 1024 ** 3, 1), 'no_source_cells': len(unavailable), 'checks': checks}), flush=True)
    return result


def verified(path):
    report_path = path.with_suffix('.json')
    if not path.exists() or not report_path.exists():
        return False
    report = json.loads(report_path.read_text(encoding='utf-8'))
    if path.stat().st_size != report['bytes']:
        raise ValueError(f'Completed package size changed: {path.name}')
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != report['sha256']:
            raise ValueError(f'Completed package checksum changed: {path.name}')
    return True


def clean_generated_work(root, path):
    resolved, base = path.resolve(), root.resolve()
    if not resolved.is_relative_to(base / '.parts') or resolved == base / '.parts' or resolved.suffix not in ('.work', '.source'):
        raise ValueError('Refusing to clean a path outside this job’s generated work directory')
    if resolved.exists():
        shutil.rmtree(resolved)


def download_source(root, cell, log):
    """Bounded, ETag-guarded range downloads. Partial bytes survive a restart."""
    cache = root / '.parts' / (cell['id'] + '.source'); cache.mkdir(exist_ok=True)
    path = cache / cell['url'].rsplit('/', 1)[-1]
    recipe = {'url': cell['url'], 'bytes': cell['bytes'], 'etag': cell['etag']}
    recipe_path = cache / 'source.json'
    if recipe_path.exists() and json.loads(recipe_path.read_text(encoding='utf-8')) != recipe:
        raise ValueError('Source object changed; preserve this cache and use a new job directory')
    atomic_json(recipe_path, recipe)
    if path.exists():
        if path.stat().st_size != cell['bytes']:
            raise ValueError('Completed source has an unexpected size')
        return cache
    partial = path.with_suffix('.download')
    attempts = 0
    persistent = True
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    fallback = urllib.request.build_opener(NoRedirect)
    if partial.exists() and partial.stat().st_size > cell['bytes']:
        raise ValueError('Partial source exceeds expected size; preserve it for inspection')
    # One session per cell/worker: reuse TLS connections without sharing a
    # mutable Session across threads. Requests retains system proxy support.
    with requests.Session() as session, partial.open('ab') as stream:
        while stream.tell() < cell['bytes']:
            start = stream.tell(); end = min(cell['bytes'], start + 16 * 1024 ** 2) - 1
            headers = {'Range': f'bytes={start}-{end}', 'If-Match': '"' + cell['etag'] + '"', 'Accept-Encoding': 'identity'}
            try:
                response = (session.get(cell['url'], headers=headers, timeout=(30, 90), stream=True, allow_redirects=False)
                            if persistent else fallback.open(urllib.request.Request(cell['url'], headers=headers), timeout=90))
                with response:
                    status = response.status_code if persistent else response.status
                    if status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{cell["bytes"]}' or response.headers.get('ETag', '').strip('"') != cell['etag']:
                        raise ValueError('Source range or ETag mismatch; download was not accepted')
                    remaining = end - start + 1
                    if response.headers.get('Content-Encoding', 'identity').lower() != 'identity' or (response.headers.get('Content-Length') is not None and int(response.headers['Content-Length']) != remaining):
                        raise ValueError('Unexpected encoded source or range length')
                    while remaining:
                        chunk = (response.raw.read(min(1024 ** 2, remaining), decode_content=False)
                                 if persistent else response.read(min(1024 ** 2, remaining)))
                        if not chunk:
                            raise OSError('Source range ended early')
                        stream.write(chunk); remaining -= len(chunk)
                stream.flush(); os.fsync(stream.fileno()); attempts = 0
                log.write(f'Downloaded {stream.tell()}/{cell["bytes"]} source bytes\n'); log.flush()
            except ValueError:
                # A provenance/protocol mismatch must not be retried through
                # another transport; preserve the partial for inspection.
                raise
            except Exception as error:
                stream.flush(); attempts += 1
                log.write(f'Range connection interrupted ({type(error).__name__}); preserving {stream.tell()} bytes\n'); log.flush()
                if persistent:
                    # Some system proxies intermittently reject pooled TLS.
                    # Fall back only for this cell, with the same TLS/proxy,
                    # Range/ETag checks and redirect refusal.
                    persistent = False
                    session.close()
                    log.write('Retrying with non-pooled HTTPS transport\n'); log.flush()
                if attempts >= 4:
                    raise
                time.sleep(2 ** attempts)
    if partial.stat().st_size != cell['bytes']:
        raise ValueError('Source download size mismatch')
    partial.rename(path)
    return cache


def build_cell(root, cell):
    output = root / '.parts' / (cell['id'] + '.pmtiles')
    if verified(output):
        return cell['id']
    if output.exists():
        raise ValueError('Unverified completed cell exists; preserve it and inspect the report before resuming')
    if shutil.disk_usage(root).free < 30 * 1024 ** 3:
        raise OSError('Less than 30 GiB free; the job stopped without removing completed packages')
    partial = output.with_suffix('.partial')
    if partial.exists():
        # Only this job's derived, unfinished PMTiles output is replaced.
        if partial.resolve().parent != (root / '.parts').resolve():
            raise ValueError('Unsafe partial path')
        partial.unlink()
    log = root / 'logs' / (cell['id'] + '.log')
    command = [sys.executable, '-u', str(Path(__file__).with_name('build-offline-map-pack.py')),
               '--bbox', *map(str, cell['bbox']), '--name', 'China 10 m / ' + cell['id'], '--output', str(output)]
    env = dict(os.environ, TMP=str(root / '.temp'), TEMP=str(root / '.temp'), PYTHONUTF8='1')
    with log.open('a', encoding='utf-8') as stream:
        stream.write('\nStarting or resuming source cell\n'); stream.flush()
        source_dir = download_source(root, cell, stream)
        command.extend(['--source-dir', str(source_dir)])
        subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, env=env, check=True)
    if not verified(output):
        raise ValueError('Cell has no complete verification report')
    clean_generated_work(root, output.with_suffix('.work'))
    clean_generated_work(root, output.with_suffix('.source'))
    return cell['id']


def merge_region(root, region, cells):
    output = root / f'china-10m-2021-{region.lower()}.pmtiles'
    if verified(output):
        return output
    if output.exists():
        raise ValueError('Unverified regional output exists; inspect it before resuming')
    west = min(c['bbox'][0] for c in cells); south = min(c['bbox'][1] for c in cells)
    east = max(c['bbox'][2] for c in cells); north = max(c['bbox'][3] for c in cells)
    # Keep the writer's temporary tile stream on the selected output volume.
    tempfile.tempdir = str(root / '.temp')
    partial = output.with_suffix('.partial')
    if partial.exists():
        if partial.resolve().parent != root.resolve():
            raise ValueError('Unsafe partial path')
        partial.unlink()
    with ExitStack() as stack:
        readers, entries = [], {}
        for cell in cells:
            stream = stack.enter_context((root / '.parts' / (cell['id'] + '.pmtiles')).open('rb'))
            def read(offset, length, stream=stream):
                stream.seek(offset); return stream.read(length)
            reader = Reader(read); readers.append(reader)
            for (z, x, y), _ in all_tiles(read):
                entries.setdefault((z, x, y), []).append(len(readers) - 1)
        stream = stack.enter_context(partial.open('xb')); writer = Writer(stream)
        for (z, x, y), sources in sorted(entries.items(), key=lambda entry: zxy_to_tileid(*entry[0])):
            tiles = [readers[index].get(z, x, y) for index in sources]
            if len(tiles) == 1:
                encoded = tiles[0]
            else:
                # Degree cells share edge tiles; compose alpha rather than
                # dropping one cell's pixels when merging the regional archive.
                image = Image.new('RGBA', (256, 256))
                for data in tiles:
                    with Image.open(io.BytesIO(data)) as tile:
                        image.alpha_composite(tile.convert('RGBA'))
                buffer = io.BytesIO(); image.save(buffer, format='WEBP', quality=85, method=4); encoded = buffer.getvalue()
            writer.write_tile(zxy_to_tileid(z, x, y), encoded)
        header = {'tile_type': TileType.WEBP, 'tile_compression': Compression.NONE,
                  'min_lon_e7': west * 10 ** 7, 'min_lat_e7': south * 10 ** 7,
                  'max_lon_e7': east * 10 ** 7, 'max_lat_e7': north * 10 ** 7, 'center_zoom': 8}
        metadata = {'name': f'中国 10 米 · {west}–{east}°E / {south}–{north}°N', 'format': 'webp', 'type': 'baselayer',
                    'description': 'China-area offline satellite coverage; edge cells include adjoining landscapes. No administrative boundaries. Not live imagery.',
                    'attribution': 'ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
                    'license': 'CC BY 4.0', 'year': '2021', 'resolution': '10 m', 'minzoom': '6', 'maxzoom': '14',
                    'bounds': f'{west},{south},{east},{north}', 'source_urls': [c['url'] for c in cells], 'source_cells': [c['id'] for c in cells],
                    'lumina:offline': 1, 'processing': {'stretch': [0, 3000], 'gamma': 1.8, 'rgb_bands': [1, 2, 3], 'edge_merge': 'alpha composite'}}
        writer.finalize(header, metadata)
    if partial.stat().st_size > 8 * 1024 ** 3:
        raise ValueError('Regional package exceeds the app’s 8 GiB package limit; repartition required')
    partial.rename(output)
    with output.open('rb') as stream:
        sha = hashlib.file_digest(stream, 'sha256').hexdigest()
    atomic_json(output.with_suffix('.json'), {**metadata, 'bytes': output.stat().st_size, 'sha256': sha, 'tiles': writer.addressed_tiles, 'license_url': 'https://creativecommons.org/licenses/by/4.0/', 'data_reference': DATA_REFERENCE})
    return output


def run(root, workers):
    spec_path = root / 'plan.json'
    spec = json.loads(spec_path.read_text(encoding='utf-8')) if spec_path.exists() else plan(root)
    for name in ('.parts', '.temp', 'logs'):
        (root / name).mkdir(exist_ok=True)
    lock = root / 'build.lock'
    if lock.exists():
        pid = int(lock.read_text(encoding='ascii'))
        if os.name == 'nt':
            import ctypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.OpenProcess(0x1000, False, pid)
            alive = bool(handle) or ctypes.get_last_error() != 87
            if handle:
                kernel.CloseHandle(handle)
        else:
            try:
                os.kill(pid, 0); alive = True
            except ProcessLookupError:
                alive = False
        if alive:
            raise RuntimeError(f'A build lock belongs to running process {pid}; do not start a second writer')
        lock.unlink()
    with lock.open('x', encoding='ascii') as stream:
        stream.write(str(os.getpid()))
    state = {'status': 'running', 'pid': os.getpid(), 'started_at': time.time(), 'total_cells': len(spec['cells']), 'total_packs': len(spec['groups']), 'completed_cells': [], 'completed_packs': [], 'active_cells': [], 'failed_cells': []}
    def report():
        state['updated_at'] = time.time(); state['free_GiB'] = round(shutil.disk_usage(root).free / 1024 ** 3, 1)
        atomic_json(root / 'status.json', state)
    try:
        report()
        groups = sorted(spec['groups'], key=lambda key: min((c['bbox'][0] - 110) ** 2 + (c['bbox'][1] - 25) ** 2 for c in spec['cells'] if c['region'] == key))
        for region in groups:
            cells = [c for c in spec['cells'] if c['region'] == region]
            output = root / f'china-10m-2021-{region.lower()}.pmtiles'
            if verified(output):
                state['completed_packs'].append(output.name); state['completed_cells'].extend(c['id'] for c in cells); report(); continue
            state['region'] = region; report()
            pending = iter(cells)
            with ThreadPoolExecutor(max_workers=workers) as pool:
                jobs = {}
                while True:
                    if shutil.disk_usage(root).free < 30 * 1024 ** 3:
                        raise OSError('Less than 30 GiB free; completed packages are preserved for resuming')
                    while len(jobs) < workers and not (root / 'STOP').exists():
                        cell = next(pending, None)
                        if not cell:
                            break
                        jobs[pool.submit(build_cell, root, cell)] = cell
                    state['active_cells'] = [cell['id'] for cell in jobs.values()]; report()
                    if not jobs:
                        break
                    completed = next(as_completed(jobs)); cell = jobs.pop(completed)
                    try:
                        completed.result(); state['completed_cells'].append(cell['id'])
                        print('Completed source cell', cell['id'], flush=True)
                    except Exception as error:
                        state['failed_cells'].append({'id': cell['id'], 'error': str(error) or type(error).__name__})
                    report()
            if (root / 'STOP').exists():
                state['status'] = 'stopped'; report(); return
            if any(c['id'] in {f['id'] for f in state['failed_cells']} for c in cells):
                continue
            output = merge_region(root, region, cells)
            state['completed_packs'].append(output.name); report()
            print('Completed regional package', output.name, flush=True)
        state['active_cells'] = []; state['status'] = 'incomplete' if state['failed_cells'] else 'complete'; report()
    except BaseException as error:
        state['status'] = 'failed'; state['error'] = str(error); report(); raise
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--plan', action='store_true', help='Prepare and estimate coverage without downloading full-resolution imagery')
    parser.add_argument('--status', action='store_true', help='Print saved progress and current cell log tails without starting a build')
    parser.add_argument('--workers', type=int, choices=(1, 2, 4), default=1)
    args = parser.parse_args(); destination = args.output.resolve()
    if args.status:
        status = json.loads((destination / 'status.json').read_text(encoding='utf-8'))
        spec = json.loads((destination / 'plan.json').read_text(encoding='utf-8'))
        summary = {key: status.get(key) for key in ('status', 'pid', 'region', 'total_cells', 'total_packs', 'free_GiB', 'error')}
        summary.update(completed_cells=len(status['completed_cells']), completed_packs=len(status['completed_packs']), failed_cells=status['failed_cells'], coverage_gaps=spec.get('coverage_gaps', []))
        summary['active'] = {}
        for cell in status['active_cells']:
            log = destination / 'logs' / (cell + '.log')
            summary['active'][cell] = log.read_text(encoding='utf-8', errors='replace').splitlines()[-2:] if log.exists() else []
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    elif args.plan:
        plan(destination)
    else:
        run(destination, args.workers)
