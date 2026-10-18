"""Acceptance test for the packaged Linux bundle.

Runs the frozen executable in --serve mode against a throwaway library, exercises
import -> job -> preview -> watermark export over HTTP, and proves the original file
is untouched. Exits non-zero on the first failure so CI stops.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

EXE = Path(sys.argv[1] if len(sys.argv) > 1 else 'releases/linux/PhotoCollection/PhotoCollection')


def api(base: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def raw(base: str, path: str) -> bytes:
    with urllib.request.urlopen(base + path, timeout=30) as response:
        return response.read()


def main() -> int:
    assert EXE.is_file(), f'missing executable: {EXE}'
    work = Path(tempfile.mkdtemp(prefix='photocollection-linux-'))
    originals, data, exports = work / 'originals', work / 'data', work / 'exports'
    for folder in (originals, data, exports):
        folder.mkdir()
    source = originals / 'linux-smoke.jpg'
    from PIL import Image
    Image.new('RGB', (640, 480), 'orange').save(source)
    before = hashlib.sha256(source.read_bytes()).hexdigest()

    status = work / 'status.json'
    env = dict(os.environ, PHOTO_DATA_DIR=str(data), PHOTO_EXPORT_DIR=str(exports),
               PHOTO_MODELS_DIR=str(data / 'models'), PHOTO_AUTOLOAD_AI='0', HOME=str(work / 'home'))
    process = subprocess.Popen([str(EXE), '--serve', '--port', '0', '--status-file', str(status), '--duration', '120'],
                               env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 90
        base = None
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('server exited early:\n' + process.stdout.read().decode('utf-8', 'replace')[-4000:])
            if status.is_file():
                try:
                    base = json.loads(status.read_text('utf-8'))['url']
                    break
                except (ValueError, KeyError):
                    pass
            time.sleep(.2)
        assert base, 'no status file: packaged server did not start'

        job = api(base, '/api/photos/import', {'paths': [str(source)]})
        for _ in range(300):
            state = api(base, '/api/jobs/' + job['id'])
            if state['status'] in ('completed', 'failed'):
                break
            time.sleep(.1)
        assert state['status'] == 'completed', state
        photo = api(base, '/api/photos')['photos'][0]
        assert photo['width'] == 640 and photo['height'] == 480, photo
        assert raw(base, '/api/photos/' + photo['id'] + '/original'), 'original read failed'

        drafts = api(base, '/api/watermark/drafts', {'photo_id': photo['id'], 'settings_json': {'template': 'ambient'}})
        assert api(base, '/api/watermark/drafts/' + drafts['id'] + '/export', {'format': 'png'})
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before, 'original file was modified'

        html = raw(base, '/').decode('utf-8', 'replace')
        assert '<html' in html, 'UI index missing'
        with urllib.request.urlopen(base + '/', timeout=30) as response:
            assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
        print(f'linux bundle OK: import, job, preview, watermark export, CSP, original hash ({photo["file_name"]})')
        return 0
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
