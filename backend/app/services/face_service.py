from pathlib import Path
from typing import Any
import json
import numpy as np

_face_recognition = None
_face_recognition_available = False

try:
    import face_recognition as fr
    _face_recognition = fr
    _face_recognition_available = True
except ImportError:
    pass

def is_available() -> bool:
    return _face_recognition_available

def detect_faces(image_path: Path) -> list[dict]:
    if not _face_recognition_available:
        return []
    try:
        image = _face_recognition.load_image_file(str(image_path))
        face_locations = _face_recognition.face_locations(image, model='hog')
        face_encodings = _face_recognition.face_encodings(image, face_locations)
        faces = []
        for (top, right, bottom, left), encoding in zip(face_locations, face_encodings):
            faces.append({
                'location': {'top': top, 'right': right, 'bottom': bottom, 'left': left},
                'encoding': encoding.tobytes().hex()
            })
        return faces
    except Exception:
        return []

def compare_faces(known_encoding_hex: str, unknown_encoding_hex: str, tolerance: float = 0.6) -> bool:
    if not _face_recognition_available:
        return False
    try:
        known = bytes.fromhex(known_encoding_hex)
        unknown = bytes.fromhex(unknown_encoding_hex)
        known_enc = np.frombuffer(known, dtype=np.float64)
        unknown_enc = np.frombuffer(unknown, dtype=np.float64)
        results = _face_recognition.compare_faces([known_enc], unknown_enc, tolerance)
        return results[0] if results else False
    except Exception:
        return False

def face_distance(known_encoding_hex: str, unknown_encoding_hex: str) -> float:
    if not _face_recognition_available:
        return 1.0
    try:
        known = bytes.fromhex(known_encoding_hex)
        unknown = bytes.fromhex(unknown_encoding_hex)
        known_enc = np.frombuffer(known, dtype=np.float64)
        unknown_enc = np.frombuffer(unknown, dtype=np.float64)
        distances = _face_recognition.face_distance([known_enc], unknown_enc)
        return float(distances[0]) if len(distances) > 0 else 1.0
    except Exception:
        return 1.0
