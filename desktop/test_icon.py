import tempfile
import unittest
from pathlib import Path
from PIL import Image
from desktop.icon import application_icon


class WebIconTest(unittest.TestCase):
    def test_native_icon_uses_web_artwork(self):
        with tempfile.TemporaryDirectory() as folder:
            icon = application_icon(Path(folder))
            with Image.open(icon) as native, Image.open(Path(__file__).resolve().parents[1] / 'frontend/public/icon-512.png') as web:
                self.assertEqual(native.format, 'ICO')
                self.assertEqual(native.ico.sizes(), {(size, size) for size in (16, 24, 32, 48, 64, 128, 256)})
                expected = web.resize((256, 256), Image.Resampling.LANCZOS).convert('RGBA')
                self.assertEqual(native.convert('RGBA').tobytes(), expected.tobytes())


if __name__ == '__main__':
    unittest.main()
