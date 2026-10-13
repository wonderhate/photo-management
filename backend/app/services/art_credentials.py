"""Windows user-scoped credentials; other hosts use an environment variable."""
import ctypes
import os
from ctypes import wintypes
from ..config import DATA

KEY_FILE = DATA / 'art-key.dpapi'


def protect(value: bytes, decrypt: bool = False) -> bytes:
    if os.name != 'nt':
        raise ValueError('Use OPENAI_API_KEY on this platform')

    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_char))]

    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    result = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
        raise ValueError('Cannot access the Windows-protected API key; please save it again')
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        kernel.LocalFree(ctypes.cast(result.data, ctypes.c_void_p))


def get_key() -> str:
    if os.environ.get('OPENAI_API_KEY', '').strip():
        return os.environ['OPENAI_API_KEY'].strip()
    if KEY_FILE.is_file():
        return protect(KEY_FILE.read_bytes(), decrypt=True).decode('utf-8')
    raise ValueError('Configure an OpenAI API key first')


def save_key(value: str) -> None:
    value = value.strip()
    if not 10 <= len(value) <= 512 or any(c.isspace() for c in value):
        raise ValueError('Invalid API key')
    encrypted = protect(value.encode('utf-8'))
    temporary = KEY_FILE.with_suffix('.tmp')
    try:
        temporary.write_bytes(encrypted)
        temporary.replace(KEY_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def status() -> dict:
    configured, error = False, False
    try:
        configured = bool(get_key())
    except (OSError, ValueError):
        error = KEY_FILE.is_file()
    return {'configured': configured, 'key_error': error, 'can_save_key': os.name == 'nt',
            'key_source': 'environment' if os.environ.get('OPENAI_API_KEY') else 'windows' if configured else 'none'}
