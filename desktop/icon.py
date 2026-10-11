"""Use the web app artwork for the native executable and window."""
from pathlib import Path
import sys
from PIL import Image


def application_icon(directory: Path) -> Path:
    if getattr(sys, 'frozen', False):
        return Path(__file__).with_name('PhotoCollection.ico')
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'PhotoCollection.ico'
    with Image.open(Path(__file__).resolve().parents[1] / 'frontend/public/icon-512.png') as source:
        source.save(target, format='ICO', sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
    return target
