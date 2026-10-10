"""One localhost server owned by one desktop window; no LAN listener."""
import argparse
import json
import logging
import multiprocessing
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true', help='Run without a window for diagnostics')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--duration', type=float, default=0)
    parser.add_argument('--status-file', type=Path)
    parser.add_argument('--dialog', choices=['files', 'directory'])
    parser.add_argument('--result', type=Path)
    args = parser.parse_args()
    if args.dialog:
        from backend.app.dialog import select_paths
        if not args.result: parser.error('--dialog requires --result')
        args.result.write_text(json.dumps(select_paths(args.dialog)), 'utf-8')
        return
    log_dir = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'PhotoCollection' / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    # Windowed Windows executables have no stdout; uvicorn logging requires a stream.
    stream = (log_dir / 'desktop.log').open('a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = stream
    logging.basicConfig(stream=stream, level=logging.INFO)
    from backend.app.main import app
    import uvicorn
    sock = socket.socket()
    sock.bind(('127.0.0.1', args.port))
    sock.listen(128)
    url = f'http://127.0.0.1:{sock.getsockname()[1]}'
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', log_level='info'))
    worker = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    worker.start()
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if not worker.is_alive(): raise RuntimeError(f'启动失败，请查看 {log_dir}')
            try:
                with opener.open(url + '/api/health', timeout=2) as response:
                    health = json.load(response)
                break
            except (OSError, ValueError): time.sleep(.2)
        else: raise TimeoutError('本地服务未能及时启动')
        if args.status_file:
            args.status_file.write_text(json.dumps({'url': url, **health}), 'utf-8')
        if args.serve:
            worker.join(args.duration or None)
        else:
            import webview
            webview.settings['ALLOW_DOWNLOADS'] = True
            webview.create_window('光影集 · 摄影管理', url, width=1440, height=960, min_size=(900, 650), background_color='#151719')
            webview.start(gui='edgechromium', private_mode=False, storage_path=str(log_dir.parent / 'webview'))
    finally:
        server.should_exit = True
        worker.join(timeout=15)
        sock.close()
        stream.flush()


if __name__ == '__main__':
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as error:
        logging.exception('Desktop application failed')
        if '--serve' not in sys.argv and '--dialog' not in sys.argv:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, str(error), '光影集启动失败', 0x10)
        raise
