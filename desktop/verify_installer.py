"""Install, upgrade and uninstall the real installer using only isolated test data."""
import json
from contextlib import closing
import hashlib
import sqlite3
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
    for hive in (winreg.HKEY_CURRENT_USER,winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY,winreg.KEY_WOW64_32KEY):
            try:entry=winreg.OpenKey(hive,KEY,access=winreg.KEY_READ|view)
            except FileNotFoundError:continue
            with entry:
                try:return {name:winreg.QueryValueEx(entry,name)[0] for name in ('InstallLocation','DisplayVersion')}
                except FileNotFoundError:
                    raise RuntimeError('An incomplete installed registration exists; use a separate Windows test account.') from None
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
        original = work / 'synthetic-original.jpg'
        original.write_bytes(b'synthetic source whose bytes must survive installation')
        original_hash = hashlib.sha256(original.read_bytes()).hexdigest()
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
            seed_env=os.environ|{'PHOTO_DATA_DIR':str(data),'PHOTO_LIBRARY_CONFIG':str(work/'seed-config.json'),
                'PHOTO_MODELS_DIR':str(work/'models'),'PHOTO_EXPORT_DIR':str(work/'exports'),'PHOTO_AUTOLOAD_AI':'0'}
            # A previous-schema synthetic library exercises the application's
            # startup migration after installation, not only an unrelated sentinel.
            subprocess.run([sys.executable,'-c',
                "from backend.app.models import initialize; initialize(); import sqlite3,sys; "
                "c=sqlite3.connect(sys.argv[1]); c.execute('DROP TABLE vision_assets'); "
                "c.execute('PRAGMA user_version=27'); c.commit(); c.close()",str(data/'library.db')],
                cwd=ROOT,env=seed_env,check=True,timeout=60,creationflags=subprocess.CREATE_NO_WINDOW)
            old_database=(data/'library.db').read_bytes()
            run([str(installer), *args, '/LOG=' + str(work / 'upgrade.log')])
            assert config.read_bytes() == saved and sentinel.is_file() and (data/'library.db').read_bytes()==old_database, 'Upgrade replaced user data/configuration'
            run([sys.executable, str(ROOT / 'desktop/verify_package.py'), str(exe)])
            status = work / 'window.json'
            env = seed_env | {'LOCALAPPDATA': str(work / 'profile')}
            subprocess.run([str(exe), '--window-check', '--status-file', str(status)], env=env, check=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
            assert json.loads(status.read_text())['window_loaded'] is True, 'Native window did not load'
            with closing(sqlite3.connect(data/'library.db')) as db:
                assert db.execute('PRAGMA user_version').fetchone()[0]==28
                assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            backups=list((data/'backups').glob('*.db'))
            assert len(backups)==1
            with closing(sqlite3.connect(backups[0])) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==27
            assert hashlib.sha256(original.read_bytes()).hexdigest()==original_hash
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
                assert (data/'library.db').is_file() and hashlib.sha256(original.read_bytes()).hexdigest()==original_hash
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
            # Test paths plus WebView2 cache names can exceed Windows' legacy 260-character limit.
            cleanup_path = '\\\\?\\' + str(work.resolve())
            for _ in range(150):
                try:
                    shutil.rmtree(cleanup_path)
                    break
                except OSError:
                    time.sleep(.2)
            else:
                raise TimeoutError('Test WebView2 cache is still in use')


if __name__ == '__main__':
    main()
