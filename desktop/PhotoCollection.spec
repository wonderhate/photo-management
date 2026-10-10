from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

root = Path(SPECPATH).parent
datas = [(str(root/'frontend'/'dist'), 'frontend/dist'),
         (str(root/'backend'/'app'/'assets'), 'backend/app/assets'),
         (str(root/'.cache'/'packaging'/'build-id.txt'), 'backend')]
for package in ('transformers', 'huggingface_hub', 'safetensors', 'tokenizers'):
    datas += copy_metadata(package)
datas += collect_data_files('transformers', include_py_files=True)
a = Analysis([str(root/'desktop'/'launcher.py')], pathex=[str(root)], datas=datas,
             hiddenimports=collect_submodules('backend.app') + ['webview.platforms.edgechromium', 'tkinter', 'PIL._tkinter_finder', 'faiss'],
             excludes=['PyQt5','PyQt6','PySide2','PySide6','IPython','matplotlib','tensorflow','torchaudio','torchvision'],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='PhotoCollection', console=False)
coll = COLLECT(exe, a.binaries, a.datas, name='PhotoCollection')
