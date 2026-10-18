"""PyInstaller spec for Windows (WebView2), macOS (WKWebView) and Linux (QtWebEngine)."""
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata
from backend.version import VERSION
from desktop.icon import application_icon

WINDOWS = sys.platform == 'win32'

root = Path(SPECPATH).parent
icon = application_icon(root / '.cache' / 'packaging')
datas = [(str(root/'frontend'/'dist'), 'frontend/dist'),
         (str(icon), 'desktop'),
         (str(root/'backend'/'app'/'assets'), 'backend/app/assets'),
         (str(root/'.cache'/'packaging'/'build-id.txt'), 'backend')]
for package in ('transformers', 'huggingface_hub', 'safetensors', 'tokenizers'):
    datas += copy_metadata(package)
datas += collect_data_files('transformers', include_py_files=True)

window_backends = ['webview.platforms.edgechromium', 'tkinter', 'PIL._tkinter_finder'] if WINDOWS else ['webview.platforms.qt', 'PIL._tkinter_finder']
a = Analysis([str(root/'desktop'/'launcher.py')], pathex=[str(root)], datas=datas,
             hiddenimports=collect_submodules('backend.app') + window_backends + ['faiss'],
             excludes=['PyQt5', 'PySide2', 'PySide6', 'IPython', 'matplotlib', 'tensorflow', 'torchaudio', 'torchvision']
                      + (['PyQt6'] if WINDOWS else []),
             noarchive=False)
pyz = PYZ(a.pure)

if WINDOWS:
    from PyInstaller.utils.win32.versioninfo import VSVersionInfo, FixedFileInfo, StringFileInfo, StringTable, StringStruct, VarFileInfo, VarStruct
    version = VSVersionInfo(
        ffi=FixedFileInfo(filevers=tuple(map(int, VERSION.split('.'))) + (0,),
                          prodvers=tuple(map(int, VERSION.split('.'))) + (0,), fileType=1),
        kids=[StringFileInfo([StringTable('040904B0', [StringStruct(key, value) for key, value in {
            'FileDescription': 'Photo Collection - Local Photo Management',
            'ProductName': 'Photo Collection', 'FileVersion': VERSION, 'ProductVersion': VERSION,
            'OriginalFilename': 'PhotoCollection.exe',
        }.items()])]), VarFileInfo([VarStruct('Translation', [1033, 1200])])])
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='PhotoCollection', console=False, version=version, upx=False, icon=str(icon))
else:
    exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='PhotoCollection', console=False, upx=False)

coll = COLLECT(exe, a.binaries, a.datas, name='PhotoCollection', upx=False)
