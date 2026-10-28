"""Local desktop server and native window.

Windows uses WebView2 (pywebview gui='edgechromium'); macOS uses WKWebView ('cocoa');
Linux uses QtWebEngine ('qt'). The backend and UI are identical on every platform.
"""
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
from uuid import uuid4


def follow_browser_fullscreen(window) -> None:
    if os.name != 'nt':
        return  # ponytail: only WebView2 reports ContainsFullScreenElement; Qt/GTK fullscreen is handled in-app
    from System import Action
    native = window.native
    def bind() -> None:
        if getattr(native, '_photo_fullscreen_bound', False): return
        core = native.webview.CoreWebView2
        def changed(sender, event) -> None:
            if bool(core.ContainsFullScreenElement) != native.is_fullscreen:
                native.toggle_fullscreen()
        core.ContainsFullScreenElementChanged += changed
        native._photo_fullscreen_bound = True
        native._photo_fullscreen_handler = changed
    native.Invoke(Action(bind))


def state_dir() -> Path:
    """Mirrors backend.app.config.state_root() so logging works before the app imports."""
    if os.name == 'nt':
        base = os.environ.get('LOCALAPPDATA') or Path.home()
    elif sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support'
    else:
        base = os.environ.get('XDG_STATE_HOME') or Path.home() / '.local' / 'state'
    return Path(base) / 'PhotoCollection'


def gui_backend() -> str:
    if os.name == 'nt': return 'edgechromium'
    if sys.platform == 'darwin': return 'cocoa'
    return 'qt'


def report_fatal(error: Exception) -> None:
    if os.name == 'nt':
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, str(error), '光影集启动失败', 0x10)


def restart_arguments(args, port):
    result=[sys.executable] if getattr(sys,'frozen',False) else [sys.executable,'-m','desktop.launcher']
    result+=['--port',str(port)]
    if args.serve:result.append('--serve')
    if args.duration:result+=['--duration',str(args.duration)]
    if args.status_file:result+=['--status-file',str(args.status_file.resolve())]
    if args.window_check:result.append('--window-check')
    if args.window_check_path!='/':result+=['--window-check-path',args.window_check_path]
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true', help='Run without a window for diagnostics')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--duration', type=float, default=0)
    parser.add_argument('--status-file', type=Path)
    parser.add_argument('--window-check', action='store_true', help='Verify native WebView startup, then close')
    parser.add_argument('--window-check-path', choices=['/','/watercolor','/watermark/gallery','/tools/analyze','/tools/raw','/tools/edit'], default='/')
    parser.add_argument('--dialog', choices=['files','videos','directory','catalog','lut-directory'])
    parser.add_argument('--result', type=Path)
    args = parser.parse_args()
    if args.dialog:
        from backend.app.dialog import select_paths
        if not args.result: parser.error('--dialog requires --result')
        args.result.write_text(json.dumps(select_paths(args.dialog)), 'utf-8')
        return
    log_dir = state_dir() / 'logs'
    log_dir.mkdir(parents=True, exist_ok=True)
    # Windowed Windows executables have no stdout; uvicorn logging requires a stream.
    stream = (log_dir / 'desktop.log').open('a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = stream
    logging.basicConfig(stream=stream, level=logging.INFO)
    from backend.app.main import app
    import uvicorn
    sock = socket.socket()
    try:
        sock.bind(('127.0.0.1', args.port or 8000))
    except OSError:
        if args.port: raise
        sock.bind(('127.0.0.1', 0))
    sock.listen(128)
    url = f'http://127.0.0.1:{sock.getsockname()[1]}'
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', log_level='info', proxy_headers=False))
    worker = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    from backend.app import runtime_control
    restart_requested=threading.Event();window=None;run_id=str(uuid4())
    def restart():
        restart_requested.set()
        if window is not None:window.destroy()
        else:server.should_exit=True
    runtime_control.install(restart)
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
            args.status_file.write_text(json.dumps({'url': url, **health,'pid':os.getpid(),'run_id':run_id}), 'utf-8')
        if args.serve:
            worker.join(args.duration or None)
        else:
            import webview
            from desktop.icon import application_icon
            webview.settings['ALLOW_DOWNLOADS'] = True
            window=webview.create_window('光影集 · 摄影管理', url+(args.window_check_path if args.window_check else ''), width=1440, height=960, min_size=(900, 650), background_color='#f4f5f8')
            window_check_result={}
            def shown() -> None:
                if os.name == 'nt':
                    from desktop.native_file_drag import NativeFileDrag
                    from backend.app.services.file_actions import install_native_drag
                    install_native_drag(NativeFileDrag(window.native))
            window.events.shown += shown
            def loaded() -> None:
                follow_browser_fullscreen(window)
                if args.window_check:
                    # A WebView load event can also mean a blank React shell or
                    # failed module import. Wait for the actual app and report
                    # supported browser primitives without opening any photos.
                    deadline=time.monotonic()+40
                    while time.monotonic()<deadline:
                        state=window.evaluate_js("""JSON.stringify({
                            app_ready:!!document.querySelector('.app-shell .topbar'),
                            home_ready:!!document.querySelector('.home-page'),
                            watercolor_ready:!!document.querySelector('.art-page'),
                            isolated:crossOriginIsolated,
                            wasm:typeof WebAssembly==='object',
                            worker:typeof Worker==='function',
                            path:location.pathname
                        })""")
                        state=json.loads(state) if isinstance(state,str) else state
                        if state and state.get('app_ready'):
                            if args.window_check_path=='/' and not state.get('home_ready'):time.sleep(.1);continue
                            if args.window_check_path=='/watercolor' and not state.get('watercolor_ready'):time.sleep(.1);continue
                            window_check_result.update(state)
                            break
                        time.sleep(.1)
                    window_check_result['window_loaded']=bool(window_check_result.get('app_ready'))
                    if args.status_file: args.status_file.write_text(json.dumps({'url':url, **health, **window_check_result}), 'utf-8')
                    window.destroy()
            window.events.loaded += loaded
            webview.start(gui=gui_backend(), private_mode=False, storage_path=str(log_dir.parent / 'webview'), icon=str(application_icon(log_dir.parent)))
            if args.window_check and not all(window_check_result.get(key) for key in ('window_loaded','isolated','wasm','worker')):
                raise RuntimeError('Native window did not render the application with the required local runtime capabilities')
    finally:
        from backend.app.services.file_actions import install_native_drag
        install_native_drag(None)
        server.should_exit = True
        worker.join(timeout=15)
        sock.close()
        stream.flush()
        runtime_control.install(None)
    if restart_requested.is_set():
        if worker.is_alive():raise RuntimeError('旧服务尚未结束，未启动另一图库；请等待后重新打开程序')
        from backend.app.models import engine
        engine.dispose()
        arguments=restart_arguments(args,int(url.rsplit(':',1)[1]))
        if not getattr(sys,'frozen',False):os.chdir(Path(__file__).resolve().parents[1])
        os.execv(sys.executable,arguments)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as error:
        logging.exception('Desktop application failed')
        if '--serve' not in sys.argv and '--dialog' not in sys.argv:
            report_fatal(error)
        raise
