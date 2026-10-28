import json
import os
import sys
from pathlib import Path
from . import storage
from . import catalog

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent
FROZEN = getattr(sys, 'frozen', False)


def state_root() -> Path:
    """Per-user application directory. Mirrored in desktop/launcher.py for early logging."""
    if os.name == 'nt':
        return Path(os.environ.get('LOCALAPPDATA') or Path.home())
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support'
    return Path(os.environ.get('XDG_STATE_HOME') or Path.home() / '.local' / 'state')


USER_ROOT = state_root() / 'PhotoCollection' if FROZEN else PROJECT
LOCAL_CONFIG_FILE = Path(os.environ.get('PHOTO_LIBRARY_CONFIG', (Path(os.environ['PHOTO_DATA_DIR']) if 'PHOTO_DATA_DIR' in os.environ else USER_ROOT) / 'library-config.json')).resolve()
LEGACY_CONFIG_FILE = Path(sys.executable).parent / 'library-config.json' if FROZEN and 'PHOTO_DATA_DIR' not in os.environ else None
LOCAL_CONFIG = storage.read_config(LOCAL_CONFIG_FILE,LEGACY_CONFIG_FILE)
LOCKED_STORAGE = [key for key,env in [('data_dir','PHOTO_DATA_DIR'),('models_dir','PHOTO_MODELS_DIR'),('exports_dir','PHOTO_EXPORT_DIR')] if env in os.environ]
LOCAL_CONFIG, STORAGE_ERROR = storage.apply_pending(LOCAL_CONFIG_FILE,LOCAL_CONFIG,LOCKED_STORAGE)
LOCAL_CONFIG, CATALOG_ERROR = catalog.apply_pending(LOCAL_CONFIG_FILE,LOCAL_CONFIG,LOCKED_STORAGE)
# Explicit environment libraries (including tests) are isolated from machine defaults.
USE_LOCAL_CONFIG = 'PHOTO_DATA_DIR' not in os.environ
DATA = Path(os.environ.get('PHOTO_DATA_DIR', LOCAL_CONFIG.get('data_dir', USER_ROOT / 'data'))).resolve()
DEFAULT_EXPORTS = Path.home() / 'Downloads' if FROZEN else DATA / 'exports'
EXPORTS = Path(os.environ.get('PHOTO_EXPORT_DIR', LOCAL_CONFIG.get('exports_dir', DEFAULT_EXPORTS))).resolve()
SCAN_PATHS = [str(Path(value).resolve()) for value in LOCAL_CONFIG.get('scan_paths', [])]
MODELS = Path(os.environ.get('PHOTO_MODELS_DIR', LOCAL_CONFIG.get('models_dir', USER_ROOT / 'models' if USE_LOCAL_CONFIG else DATA / 'models'))).resolve()
EXPORT_ROOTS = [EXPORTS] + [Path(value).resolve() for value in LOCAL_CONFIG.get('previous_exports_dirs',[])]
AUTOLOAD_AI = os.environ.get('PHOTO_AUTOLOAD_AI', '1') == '1'
for folder in ('thumbnails', 'watermark_previews', 'previews', 'embeddings', 'exports', 'imports', 'artworks'):
    (DATA / folder).mkdir(parents=True, exist_ok=True)
MODELS.mkdir(parents=True, exist_ok=True)
EXPORTS.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = DATA / 'settings.json'
DEFAULTS = {
    'thumbnail_quality': 85, 'count_mode': 'capture', 'preview_preference': 'jpeg',
    'ai_model': 'OFA-Sys/chinese-clip-vit-base-patch16',
    'export_format': 'jpg', 'export_quality': 95, 'export_long_edge': 4096,
    'focal_bands': [24, 35, 60, 100, 200],
    'auto_face_analysis': False,
    'art_image_model': 'qwen-image-3.0', 'art_title_model': 'qwen3-vl-plus',
}

def settings() -> dict:
    try:
        result = DEFAULTS | json.loads(SETTINGS_FILE.read_text('utf-8'))
        # Existing OpenAI settings are replaced when switching the watercolor provider.
        for key in ('art_image_model', 'art_title_model'):
            if str(result[key]).startswith('gpt-'):
                result[key] = DEFAULTS[key]
        return result
    except (FileNotFoundError, ValueError):
        return DEFAULTS.copy()

def save_settings(value: dict) -> dict:
    merged = settings() | {k: v for k, v in value.items() if k in DEFAULTS}
    temporary = SETTINGS_FILE.with_suffix('.tmp')
    temporary.write_text(json.dumps(merged, ensure_ascii=False, indent=2), 'utf-8')
    temporary.replace(SETTINGS_FILE)
    return merged


def storage_paths() -> dict:
    current = {'data_dir':str(DATA),'models_dir':str(MODELS),'exports_dir':str(EXPORTS),'scan_paths':SCAN_PATHS}
    pending = storage.read_config(LOCAL_CONFIG_FILE,LEGACY_CONFIG_FILE).get('pending_paths')
    return {'current':current,'pending':pending,'locked_fields':LOCKED_STORAGE,'error':STORAGE_ERROR if pending else None}


def save_storage_paths(value: dict) -> dict:
    global STORAGE_ERROR
    storage.save_paths(LOCAL_CONFIG_FILE,storage_paths()['current'],value,LOCKED_STORAGE,LEGACY_CONFIG_FILE)
    STORAGE_ERROR = None
    return storage_paths()


def cancel_storage_paths() -> dict:
    global STORAGE_ERROR
    with storage.lock:
        config = storage.read_config(LOCAL_CONFIG_FILE,LEGACY_CONFIG_FILE)
        config.pop('pending_paths',None)
        storage.write_config(LOCAL_CONFIG_FILE,config)
    STORAGE_ERROR = None
    return storage_paths()

RAW_EXTENSIONS = {'.dng','.cr2','.cr3','.crw','.nef','.nrw','.arw','.sr2','.raf','.rw2','.orf','.pef',
                  '.srw','.raw','.3fr','.iiq','.erf','.kdc','.dcr','.mef','.mos','.mrw','.x3f'}
EXTENSIONS = RAW_EXTENSIONS | {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.heif', '.webp', '.avif'}
