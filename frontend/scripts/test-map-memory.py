"""Synthetic tests for bounded map memory waits; no production data accessed."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('map_pack', Path(__file__).with_name('build-offline-map-pack.py'))
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class MemoryWaitTests(unittest.TestCase):
    def test_waits_then_resumes_when_headroom_recovers(self):
        with patch.object(pack, 'memory_headroom', side_effect=[1024**3, 1024**3, 3*1024**3]), patch.object(pack.time, 'sleep') as sleep:
            pack.wait_for_memory()
            self.assertEqual(sleep.call_count, 2)

    def test_persistent_pressure_has_a_bounded_deadline(self):
        with patch.object(pack, 'memory_headroom', return_value=1024**3), patch.object(pack.time, 'monotonic', side_effect=[0, 901]):
            with self.assertRaisesRegex(MemoryError, 'checkpoint retained'):
                pack.wait_for_memory()

    def test_normal_or_non_windows_headroom_does_not_wait(self):
        for available in (None, 2*1024**3, 4*1024**3):
            with self.subTest(available=available), patch.object(pack, 'memory_headroom', return_value=available), patch.object(pack.time, 'sleep') as sleep:
                pack.wait_for_memory()
                sleep.assert_not_called()


if __name__ == '__main__': unittest.main()
