import base64
import json
import random
import socket
import threading
import time
import unittest
from io import BytesIO
from pathlib import Path

import httpx
import uvicorn
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect
from websockets.sync.client import connect

from cloud_relay.app import create_app, Request, payload, clean_image
from .protocol import validate_image_url

ORIGIN = 'https://photos.example.test'


def fixture():
    image = Image.new('RGB', (64, 40), '#367b89')
    exif = Image.Exif()
    exif[0x010F] = 'PRIVATE_SYNTHETIC_METADATA'
    buffer = BytesIO()
    image.save(buffer, 'JPEG', exif=exif)
    return buffer.getvalue()


def submit(socket, raw, **changes):
    metadata = {'action': 'generate', 'api_key': 'synthetic-session-key', 'model': 'qwen-image-3.0', 'image_size': len(raw)} | changes
    socket.send_json(metadata)
    socket.send_bytes(raw)
    socket.send_json({'type': 'submit'})


class RelayTest(unittest.TestCase):
    def test_compressed_full_chunks_round_trip_and_oversized_chunk_is_rejected(self):
        # Test the real wire limit from the shipped launcher; TestClient doesn't enforce it.
        command = next(line[4:] for line in Path(__file__).with_name('Dockerfile').read_text().splitlines() if line.startswith('CMD '))
        args = json.loads(command)
        maximum = int(args[args.index('--ws-max-size') + 1])
        calls = []

        async def provider(_request, raw, _size, _client):
            calls.append(1)
            return {'output': {'choices': [{'message': {'content': [{'image': 'data:image/png;base64,' + base64.b64encode(raw).decode()}]}}]}}

        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        server = uvicorn.Server(uvicorn.Config(create_app(ORIGIN, provider), ws_max_size=maximum, log_level='error'))
        thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 5
            while not server.started and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(server.started)
            endpoint = f'ws://127.0.0.1:{listener.getsockname()[1]}/cloud-art'
            image = Image.frombytes('RGB', (256, 256), random.Random(0).randbytes(256 * 256 * 3))
            buffer = BytesIO()
            image.save(buffer, 'PNG')
            raw = buffer.getvalue()
            self.assertGreater(len(raw), 65536)
            with connect(endpoint, origin=ORIGIN) as ws:
                ws.send(json.dumps({'action': 'generate', 'api_key': 'synthetic', 'model': 'qwen-image-3.0', 'image_size': len(raw)}))
                for offset in range(0, len(raw), 65536):
                    ws.send(raw[offset:offset + 65536])
                ws.send(json.dumps({'type': 'submit'}))
                result = bytearray()
                while True:
                    part = ws.recv(timeout=5)
                    if isinstance(part, bytes):
                        result.extend(part)
                    else:
                        message = json.loads(part)
                        self.assertNotEqual(message['type'], 'error', message)
                        if message['type'] == 'done':
                            break
                with Image.open(BytesIO(result)) as output:
                    self.assertEqual(output.tobytes(), image.tobytes())
            with connect(endpoint, origin=ORIGIN) as ws:
                ws.send(json.dumps({'action': 'generate', 'api_key': 'synthetic', 'model': 'qwen-image-3.0', 'image_size': 65537}))
                ws.send(random.Random(1).randbytes(65537))
                self.assertEqual(json.loads(ws.recv(timeout=5))['message'], 'Invalid image chunk')
            self.assertEqual(calls, [1])
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            listener.close()

    def test_title_language_is_explicit_and_matches_request(self):
        for language, instruction in [('zh', '所有 title 标题和 evidence 说明必须使用简体中文'), ('en', 'All title and evidence values must be in English')]:
            with self.subTest(language=language):
                request = Request(action='titles', api_key='synthetic', model='qwen3-vl-plus', image_size=32,
                                  language=language, keywords='Only English titles please')
                prompt = payload(request, b'synthetic', (64, 40))['input']['messages'][0]['content'][1]['text']
                self.assertIn(instruction, prompt.split('\nContext: ')[0])
                self.assertEqual(json.loads(prompt.split('\nContext: ')[1])['language'], language)

    def test_success_strips_metadata_and_submits_once(self):
        calls = []

        async def provider(request, raw, size, _client):
            calls.append(request.model)
            with Image.open(BytesIO(raw)) as image:
                self.assertFalse(image.getexif())
                self.assertEqual(image.size, (64, 40))
            self.assertNotIn(b'PRIVATE_SYNTHETIC_METADATA', raw)
            body = payload(request, raw, size)
            self.assertEqual(body['parameters']['n'], 1)
            self.assertFalse(body['parameters']['watermark'])
            self.assertEqual(body['parameters']['size'], '64*40')
            return {'output': {'choices': [{'message': {'content': [{'image': 'data:image/png;base64,' + base64.b64encode(raw).decode()}]}}]}}

        with TestClient(create_app(ORIGIN, provider)) as client:
            with client.websocket_connect('/cloud-art', headers={'origin': ORIGIN}) as socket:
                submit(socket, fixture())
                self.assertEqual(socket.receive_json()['type'], 'result')
                image = socket.receive_bytes()
                self.assertEqual(socket.receive_json(), {'type': 'done'})
                self.assertEqual(Image.open(BytesIO(image)).size, (64, 40))
        self.assertEqual(calls, ['qwen-image-3.0'])

    def test_origin_and_invalid_key_are_rejected_without_generation(self):
        calls = []

        async def provider(*args):
            calls.append(args)
            raise AssertionError('must not reach provider')

        with TestClient(create_app(ORIGIN, provider)) as client:
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect('/cloud-art', headers={'origin': 'https://untrusted.example.test'}):
                    pass
            with client.websocket_connect('/cloud-art', headers={'origin': ORIGIN}) as socket:
                socket.send_json({'action': 'generate', 'api_key': 'DO_NOT_ECHO\nSECRET', 'model': 'qwen-image-3.0', 'image_size': 32})
                error = socket.receive_json()
                self.assertEqual(error['type'], 'error')
                self.assertNotIn('SECRET', json.dumps(error))
        self.assertEqual(calls, [])

    def test_network_failure_is_sanitized_and_never_retried(self):
        calls = []

        async def provider(*_args):
            calls.append(1)
            raise httpx.ReadTimeout('DO_NOT_ECHO_REQUEST_KEY')

        with TestClient(create_app(ORIGIN, provider)) as client:
            with client.websocket_connect('/cloud-art', headers={'origin': ORIGIN}) as socket:
                submit(socket, fixture())
                error = socket.receive_json()
                self.assertIn('No automatic retry', error['message'])
                self.assertNotIn('DO_NOT_ECHO', json.dumps(error))
        self.assertEqual(calls, [1])

    def test_fixed_models_and_download_boundaries(self):
        for url in ['http://127.0.0.1/image', 'https://127.0.0.1/image', 'https://maas.qianwenaiapi.com@127.0.0.1/image', 'https://example.test/image']:
            with self.assertRaises(ValueError):
                validate_image_url(url)
        self.assertEqual(validate_image_url('https://maas.qianwenaiapi.com/image.png'), 'https://maas.qianwenaiapi.com/image.png')
        request = Request(action='titles', api_key='synthetic', model='qwen3-vl-plus', image_size=32, keywords='synthetic')
        body = payload(request, b'synthetic', (64, 40))
        self.assertNotIn('date_taken', json.dumps(body))
        self.assertNotIn('file_name', json.dumps(body))
        self.assertNotIn(b'PRIVATE_SYNTHETIC_METADATA', clean_image(fixture())[0])
        oversized = BytesIO()
        Image.new('RGB', (1537, 1)).save(oversized, 'PNG')
        with self.assertRaises(ValueError):
            clean_image(oversized.getvalue())


if __name__ == '__main__':
    unittest.main()
