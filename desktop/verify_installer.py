"""Install, upgrade and uninstall the real installer using only isolated test data."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import winreg

ROOT = Path(__file__).resolve().parents[1]
KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{BCED57B5-7474-45C9-9D1A-0EC27E2E80F5}_is1"


def registration() -> dict[str, str] | None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, KEY, access=winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            return {name: winreg.QueryValueEx(key, name)[0] for name in ('InstallLocation', 'DisplayVersion')}
    except FileNotFoundError:
        return None


def main() -> None:
    installer = Path(sys.argv[1]).resolve()
    assert registration() is None, 'An installed copy exists; use a separate Windows test account.'
    test_root = ROOT / '.test-artifacts'
    test_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='installer-', dir=test_root) as folder:
        work = Path(folder)
        install = work / 'application'
        data = work / 'data'
        data.mkdir()
        sentinel = data / 'preserve.txt'
        sentinel.write_text('User data must survive upgrade and uninstall.')
        group = 'Photo Collection verification-' + work.name
        shortcuts = Path(os.environ['APPDATA']) / 'Microsoft/Windows/Start Menu/Programs' / group
        args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/DIR=' + str(install), '/GROUP=' + group]
        config = install / 'library-config.json'
        saved = None
        def run(command: list[str]) -> None:
            subprocess.run(command, check=True, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            run([str(installer), *args, '/LOG=' + str(work / 'install.log')])
            entry = registration()
            assert entry and Path(entry['InstallLocation']) == install, entry
            exe = install / 'PhotoCollection.exe'
            assert exe.is_file() and len(list(shortcuts.glob('*.lnk'))) == 2
            assert not (install / 'library-config.json').exists(), 'Private build configuration was distributed'
            config.write_text(json.dumps({'data_dir': str(data), 'scan_paths': []}), encoding='utf-8')
            saved = config.read_bytes()
            run([str(installer), *args, '/LOG=' + str(work / 'upgrade.log')])
            assert config.read_bytes() == saved and sentinel.is_file(), 'Upgrade replaced user data/configuration'
            run([sys.executable, str(ROOT / 'desktop/verify_package.py'), str(exe)])
            status = work / 'window.json'
            env = os.environ | {'LOCALAPPDATA': str(work / 'profile'), 'PHOTO_DATA_DIR': str(work / 'window-data'), 'PHOTO_EXPORT_DIR': str(work / 'exports'), 'PHOTO_MODELS_DIR': str(work / 'models'), 'PHOTO_AUTOLOAD_AI': '0'}
            subprocess.run([str(exe), '--window-check', '--status-file', str(status)], env=env, check=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
            assert json.loads(status.read_text())['window_loaded'] is True, 'Native window did not load'
            print('Installer: installation, shortcuts, preserved configuration, upgrade and actual application PASS')
        finally:
            entry = registration()
            if entry:
                assert Path(entry['InstallLocation']) == install, 'Refusing to uninstall an unrelated copy'
                run([str(install / 'unins000.exe'), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/LOG=' + str(work / 'uninstall.log')])
                for _ in range(100):
                    if registration() is None and not (install / 'PhotoCollection.exe').exists():
                        break
                    time.sleep(.1)
            assert registration() is None and not (install / 'PhotoCollection.exe').exists()
            assert not shortcuts.exists(), 'Start menu entries were left behind'
            if saved is not None:
                assert config.read_bytes() == saved and sentinel.is_file(), 'Uninstall removed user data/configuration'
            # Inno's temporary uninstaller can still hold its log after removing the registration.
            for _ in range(200):
                try:
                    (work / 'uninstall.log').unlink(missing_ok=True)
                    break
                except PermissionError:
                    time.sleep(.1)
            else:
                raise TimeoutError('Uninstaller has not released its test log')
            print('Installer: uninstall removes application and shortcuts, keeps configuration and data PASS')
            assert work.resolve().parent == test_root.resolve(), 'Cleanup must stay inside test artifacts'
            # WebView2 may finish writing its private test cache shortly after the window exits.
            for _ in range(150):
                try:
                    shutil.rmtree(work)
                    break
                except OSError:
                    time.sleep(.2)
            else:
                raise TimeoutError('Test WebView2 cache is still in use')


if __name__ == '__main__':
    main()
