"""Synthetic loopback tests; run with the map-tooling Python environment."""
import importlib.util
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import requests

spec = importlib.util.spec_from_file_location('map_builder', Path(__file__).with_name('build-china-map-packs.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
DATA = bytes(range(251)) * 140000  # More than two production-sized ranges.


class DownloadTests(unittest.TestCase):
    def exercise(self, mode='valid', prefix=37):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *args): pass
            def do_GET(self):
                low, high = map(int, self.headers['Range'][6:].split('-'))
                calls.append((low, high, self.client_address[1], self.headers['If-Match']))
                body = DATA[low:high+1]
                self.send_response(302 if mode == 'redirect' else 206)
                self.send_header('Content-Range', f'bytes {low}-{high}/{len(DATA)}')
                self.send_header('ETag', '"changed"' if mode in ('etag', 'fallback-etag') else '"fixture"')
                self.send_header('Content-Encoding', 'gzip' if mode == 'encoded' else 'identity')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                try:
                    if mode == 'disconnect' and len(calls) == 1:
                        self.wfile.write(body[:1024**2]); self.wfile.flush()
                        self.close_connection = True
                    else:
                        self.wfile.write(body)
                except (ConnectionError, OSError): pass
        class Server(ThreadingHTTPServer):
            def handle_error(self, request, client_address):
                import sys
                if not isinstance(sys.exc_info()[1], ConnectionError):
                    super().handle_error(request, client_address)
        server = Server(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        real_session = requests.Session
        def local_session():
            session = real_session(); session.trust_env = False
            if mode in ('transport', 'fallback-etag'):
                def broken_pool(*args, **kwargs):
                    raise requests.exceptions.SSLError('Synthetic pooled TLS rejection')
                session.get = broken_pool
            return session
        artifact_root = Path(__file__).resolve().parents[2] / '.test-artifacts/map-download'
        artifact_root.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(dir=artifact_root) as directory:
                root = Path(directory); (root/'.parts').mkdir()
                cache = root/'.parts/fixture.source'; cache.mkdir()
                partial = cache/'source.download'; partial.write_bytes(DATA[:prefix])
                cell = {'id':'fixture', 'url':f'http://127.0.0.1:{server.server_port}/source.tif', 'etag':'fixture', 'bytes':len(DATA)}
                with patch.object(builder.requests, 'Session', local_session), patch.object(builder.time, 'sleep'):
                    if mode in ('etag', 'redirect', 'encoded', 'fallback-etag'):
                        with self.assertRaises(ValueError): builder.download_source(root, cell, io.StringIO())
                        self.assertEqual(partial.read_bytes(), DATA[:prefix])
                        self.assertFalse((cache/'source.tif').exists())
                    else:
                        builder.download_source(root, cell, io.StringIO())
                        self.assertEqual((cache/'source.tif').read_bytes(), DATA)
                        self.assertFalse(partial.exists())
                self.assertTrue(all(c[3] == '"fixture"' for c in calls))
                return calls
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_production_ranges_resume_and_reuse_connection(self):
        calls = self.exercise()
        self.assertEqual(calls[0][0], 37)
        self.assertGreaterEqual(len(calls), 3)
        self.assertEqual(len({c[2] for c in calls}), 1)

    def test_interrupted_response_resumes_verified_prefix(self):
        calls = self.exercise('disconnect')
        self.assertEqual(calls[1][0], 37 + 1024**2)

    def test_wrong_etag_redirect_or_encoding_never_appended(self):
        for mode in ('etag', 'redirect', 'encoded'):
            with self.subTest(mode=mode): self.exercise(mode)

    def test_pooled_tls_failure_falls_back_and_preserves_resume(self):
        calls = self.exercise('transport')
        self.assertEqual(calls[0][0], 37)

    def test_fallback_also_rejects_changed_source_etag(self):
        self.exercise('fallback-etag')


if __name__ == '__main__': unittest.main()
