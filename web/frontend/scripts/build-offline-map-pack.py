"""Prepare an ESA WorldCover RGBNIR regional raster PMTiles archive.

Build-time only: unsigned HTTPS COG range reads, never map-provider tile scraping.
Runtime reads only the resulting local archive. See docs/offline-photo-map.md.
"""
import argparse
import ctypes
from contextlib import ExitStack
import hashlib
import io
import json
import math
import os
from pathlib import Path
import time

for _name in ('OPENBLAS_NUM_THREADS', 'OPENBLAS_DEFAULT_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ[_name] = '1'

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.windows import Window, bounds as window_bounds, from_bounds as window_from_bounds
from rasterio.warp import reproject
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

BASE = 'https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir'
CREDIT = 'ESA WorldCover project {year} / Contains modified Copernicus Sentinel data ({year}) processed by ESA WorldCover consortium'
RADIUS = 20037508.342789244


def memory_headroom():
    if os.name != 'nt':
        return None
    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', ctypes.c_uint32), ('load', ctypes.c_uint32)] + [
            (name, ctypes.c_uint64) for name in
            ('total_phys', 'avail_phys', 'total_page', 'avail_page', 'total_virtual', 'avail_virtual', 'avail_extended')]
    state = MemoryStatus(); state.length = ctypes.sizeof(state)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(state)):
        raise ctypes.WinError()
    return min(state.avail_phys, state.avail_page)


def wait_for_memory():
    """Wait at processing boundaries without changing pixels or concurrency."""
    deadline = time.monotonic() + 900
    warned = False
    while True:
        available = memory_headroom()
        if available is None or available >= 2 * 1024 ** 3:
            if warned:
                print('Memory headroom recovered; continuing checkpoint', flush=True)
            return
        if not warned:
            print('Waiting for 2 GiB physical/commit headroom; checkpoint retained', flush=True)
            warned = True
        if time.monotonic() >= deadline:
            raise MemoryError('Memory headroom remained below 2 GiB for 15 minutes; checkpoint retained')
        time.sleep(2)


def source_url(lon, lat, year):
    ns = f'{"N" if lat >= 0 else "S"}{abs(lat):02d}'
    ew = f'{"E" if lon >= 0 else "W"}{abs(lon):03d}'
    version = 'v200' if year == 2021 else 'v100'
    return f'{BASE}/{year}/{ns}/ESA_WorldCover_10m_{year}_{version}_{ns}{ew}_S2RGBNIR.tif'


def tile_range(bbox, z):
    west, south, east, north = bbox
    n = 2 ** z
    def y(lat):
        return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return range(max(0, math.floor((west + 180) / 360 * n)), min(n, math.ceil((east + 180) / 360 * n))), range(max(0, math.floor(y(north))), min(n, math.ceil(y(south))))


def prepare_rgb(bbox, year, crop, source_dir=None):
    west, south, east, north = bbox
    width, height = math.ceil((east - west) * 12000), math.ceil((north - south) * 12000)
    transform = from_bounds(*bbox, width, height)
    sources = []
    with ExitStack() as stack:
        for lat in range(math.floor(south), math.ceil(north)):
            for lon in range(math.floor(west), math.ceil(east)):
                url = source_url(lon, lat, year)
                print('Source:', url, flush=True)
                local = source_dir / url.rsplit('/', 1)[-1] if source_dir else None
                src = stack.enter_context(rasterio.open(local if local and local.is_file() else url))
                # The actual COG tags define RGB order, not the generic AWS summary.
                if src.count != 4 or 'Band 1: B04 (Red)' not in src.tags().get('bands', ''):
                    raise ValueError('Unexpected RGBNIR source bands; refusing incorrect colours')
                sources.append((src, url))
        with rasterio.open(crop, 'w', driver='GTiff', width=width, height=height, count=4, dtype='uint8', crs='EPSG:4326', transform=transform, tiled=True, blockxsize=512, blockysize=512, compress='deflate') as dst:
            for row in range(0, height, 512):
                wait_for_memory()
                for col in range(0, width, 512):
                    w, h = min(512, width - col), min(512, height - row)
                    win = Window(col, row, w, h)
                    b = window_bounds(win, transform)
                    rgba = np.zeros((4, h, w), dtype=np.uint8)
                    for src, _ in sources:
                        if b[2] <= src.bounds.left or b[0] >= src.bounds.right or b[3] <= src.bounds.bottom or b[1] >= src.bounds.top:
                            continue
                        # Clip first instead of boundless reads: GDAL can reuse
                        # its COG block cache across adjacent windows.
                        clipped = (max(b[0], src.bounds.left), max(b[1], src.bounds.bottom), min(b[2], src.bounds.right), min(b[3], src.bounds.top))
                        dx0 = max(0, round((clipped[0] - b[0]) / (b[2] - b[0]) * w))
                        dx1 = min(w, round((clipped[2] - b[0]) / (b[2] - b[0]) * w))
                        dy0 = max(0, round((b[3] - clipped[3]) / (b[3] - b[1]) * h))
                        dy1 = min(h, round((b[3] - clipped[1]) / (b[3] - b[1]) * h))
                        if dx1 <= dx0 or dy1 <= dy0:
                            continue
                        raw = src.read((1, 2, 3), window=window_from_bounds(*clipped, src.transform), out_shape=(3, dy1-dy0, dx1-dx0), resampling=Resampling.bilinear)
                        valid = np.any(raw > 0, axis=0)
                        # Fixed reflectance stretch avoids seams between source tiles.
                        rgb = np.round(np.power(np.clip(raw.astype(np.float32) / 3000, 0, 1), 1 / 1.8) * 255).astype(np.uint8)
                        patch = rgba[:, dy0:dy1, dx0:dx1]
                        patch[:3, valid] = rgb[:, valid]
                        patch[3, valid] = 255
                    dst.write(rgba, window=win)
                print(f'Prepared RGB rows {min(row + 512, height)}/{height}', flush=True)
    return [url for _, url in sources]


def build(args):
    bbox = args.bbox
    west, south, east, north = bbox
    if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
        raise ValueError('Provide west south east north without crossing the date line')
    if (east - west) * (north - south) > 4:
        raise ValueError('Build a regional package of at most 4 square degrees at a time')
    if not 5 <= args.min_zoom <= args.max_zoom <= 15:
        raise ValueError('Zoom range must be within 5..15 (14 recommended for 10 m data)')
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError('Output already exists; choose a new filename')
    output.parent.mkdir(parents=True, exist_ok=True)
    work = output.parent / (output.stem + '.work')
    work.mkdir(exist_ok=True)
    crop, recipe_path = work / 'rgb.tif', work / 'recipe.json'
    recipe = {'bbox': bbox, 'year': args.year, 'stretch': [0, 3000], 'gamma': 1.8}
    if not crop.exists() or not recipe_path.exists() or json.loads(recipe_path.read_text()) != recipe:
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='60', GDAL_HTTP_MAX_RETRY='2', GDAL_CACHEMAX=128 * 1024 * 1024):
            urls = prepare_rgb(bbox, args.year, crop, getattr(args, 'source_dir', None))
        recipe_path.write_text(json.dumps(recipe), encoding='utf-8')
    else:
        urls = [source_url(lon, lat, args.year) for lat in range(math.floor(south), math.ceil(north)) for lon in range(math.floor(west), math.ceil(east))]
        print('Reusing completed local RGB crop', flush=True)
    credit = CREDIT.format(year=args.year)
    metadata = {'name': args.name, 'format': 'webp', 'type': 'baselayer', 'description': 'Regional offline true-colour satellite composite; not live imagery.', 'attribution': credit, 'license': 'CC BY 4.0', 'year': str(args.year), 'resolution': '10 m', 'bounds': ','.join(map(str, bbox)), 'minzoom': str(args.min_zoom), 'maxzoom': str(args.max_zoom), 'lumina:offline': 1, 'source_urls': urls, 'processing': recipe}
    header = {'tile_type': TileType.WEBP, 'tile_compression': Compression.NONE, 'min_lon_e7': round(west * 1e7), 'min_lat_e7': round(south * 1e7), 'max_lon_e7': round(east * 1e7), 'max_lat_e7': round(north * 1e7), 'center_zoom': args.max_zoom - 2}
    entries = []
    for z in range(args.min_zoom, args.max_zoom + 1):
        xs, ys = tile_range(bbox, z)
        entries.extend((zxy_to_tileid(z, x, y), z, x, y) for x in xs for y in ys)
    entries.sort()
    partial = output.with_suffix('.partial')
    with rasterio.Env(GDAL_CACHEMAX=128 * 1024 * 1024), rasterio.open(crop) as src, partial.open('xb') as stream:
        writer = Writer(stream)
        for i, (tile_id, z, x, y) in enumerate(entries):
            wait_for_memory()
            side = 2 * RADIUS / 2 ** z
            transform = from_bounds(-RADIUS + x * side, RADIUS - (y + 1) * side, -RADIUS + (x + 1) * side, RADIUS - y * side, 256, 256)
            pixels = np.zeros((4, 256, 256), dtype=np.uint8)
            reproject(source=rasterio.band(src, [1, 2, 3, 4]), destination=pixels, dst_transform=transform, dst_crs='EPSG:3857', src_alpha=4, dst_alpha=4, resampling=Resampling.bilinear, num_threads=1, warp_mem_limit=32)
            if np.any(pixels[3]):
                encoded = io.BytesIO()
                Image.fromarray(np.moveaxis(pixels, 0, -1)).save(encoded, format='WEBP', quality=85, method=4)
                writer.write_tile(tile_id, encoded.getvalue())
            if i % 100 == 0 or i == len(entries) - 1:
                print(f'Packed {i + 1}/{len(entries)} tiles', flush=True)
        writer.finalize(header, metadata)
        preview = src.read(out_shape=(4, min(1000, src.height), round(src.width * min(1000, src.height) / src.height)), resampling=Resampling.bilinear)
        Image.fromarray(np.moveaxis(preview, 0, -1)).convert('RGB').save(output.with_suffix('.jpg'), quality=90)
    partial.rename(output)
    with output.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {**metadata, 'file': output.name, 'bytes': output.stat().st_size, 'sha256': digest, 'tiles': writer.addressed_tiles, 'license_url': 'https://creativecommons.org/licenses/by/4.0/', 'data_reference': 'https://registry.opendata.aws/esa-worldcover-vito-composites/'}
    output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'file': str(output), 'bytes': output.stat().st_size, 'sha256': digest, 'tiles': writer.addressed_tiles}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bbox', type=float, nargs=4, required=True, metavar=('WEST', 'SOUTH', 'EAST', 'NORTH'))
    parser.add_argument('--name', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--year', type=int, choices=(2020, 2021), default=2021)
    parser.add_argument('--source-dir', type=Path, help='Optional directory of completed original ESA COG files; provenance keeps the original source URL')
    parser.add_argument('--min-zoom', type=int, default=6)
    parser.add_argument('--max-zoom', type=int, default=14)
    build(parser.parse_args())
