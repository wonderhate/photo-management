import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent
LOCAL_CONFIG_FILE = PROJECT / 'library-config.json'
LOCAL_CONFIG = json.loads(LOCAL_CONFIG_FILE.read_text('utf-8-sig')) if LOCAL_CONFIG_FILE.exists() else {}
# Explicit environment libraries (including tests) are isolated from machine defaults.
USE_LOCAL_CONFIG = 'PHOTO_DATA_DIR' not in os.environ
DATA = Path(os.environ.get('PHOTO_DATA_DIR', LOCAL_CONFIG.get('data_dir', PROJECT / 'data'))).resolve()
EXPORTS = Path(os.environ.get('PHOTO_EXPORT_DIR', LOCAL_CONFIG.get('exports_dir', DATA / 'exports') if USE_LOCAL_CONFIG else DATA / 'exports')).resolve()
SCAN_PATHS = [str(Path(value).resolve()) for value in LOCAL_CONFIG.get('scan_paths', [])] if USE_LOCAL_CONFIG else []
MODELS = Path(os.environ.get('PHOTO_MODELS_DIR', PROJECT / 'models')).resolve()
AUTOLOAD_AI = os.environ.get('PHOTO_AUTOLOAD_AI', '1') == '1'
for folder in ('thumbnails', 'watermark_previews', 'previews', 'embeddings', 'exports', 'imports'):
    (DATA / folder).mkdir(parents=True, exist_ok=True)
MODELS.mkdir(parents=True, exist_ok=True)
EXPORTS.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = DATA / 'settings.json'
DEFAULTS = {
    'thumbnail_quality': 85, 'count_mode': 'capture', 'preview_preference': 'jpeg',
    'ai_model': 'OFA-Sys/chinese-clip-vit-base-patch16',
    'export_format': 'jpg', 'export_quality': 95, 'export_long_edge': 4096,
    'focal_bands': [24, 35, 60, 100, 200],
}

def settings() -> dict:
    try:
        return DEFAULTS | json.loads(SETTINGS_FILE.read_text('utf-8'))
    except (FileNotFoundError, ValueError):
        return DEFAULTS.copy()

def save_settings(value: dict) -> dict:
    merged = settings() | {k: v for k, v in value.items() if k in DEFAULTS}
    temporary = SETTINGS_FILE.with_suffix('.tmp')
    temporary.write_text(json.dumps(merged, ensure_ascii=False, indent=2), 'utf-8')
    temporary.replace(SETTINGS_FILE)
    return merged

RAW_EXTENSIONS = {'.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.orf', '.rw2', '.pef'}
EXTENSIONS = RAW_EXTENSIONS | {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp', '.avif'}
