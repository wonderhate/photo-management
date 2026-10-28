"""Cloud protocol tests use in-memory HTTP transport, never provider network."""
import base64
import json
import unittest
from unittest.mock import patch
from io import BytesIO
import httpx
from PIL import Image
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from cloud_relay.app import create_app
from cloud_relay.test_relay import ORIGIN,fixture

KEY='synthetic-studio-session-key'
PROFILE=dict(name='Synthetic',provider='qwen-cn',region='cn-beijing',workspace='',image_model='qwen-image-3.0',vision_model='qwen3-vl-plus',revision=1)
OPTIONS=dict(language='both',tag_count=3,caption_length=100,ocr=True,place_guess=True)


class StudioRelayTest(unittest.TestCase):
    def transport(self,handler):
        original=httpx.AsyncClient
        return patch('cloud_relay.studio.httpx.AsyncClient',side_effect=lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))

    def send(self,ws,raw,**changes):
        body=dict(action='annotation',profile=PROFILE,api_key=KEY,image_size=len(raw),options=OPTIONS)|changes
        ws.send_json(body)
        if raw:ws.send_bytes(raw)
        ws.send_json({'type':'submit'})

    def test_sanitized_annotation_bad_json_keeps_repair_without_key_or_retry(self):
        calls=[]
        def handler(request):
            calls.append(request);body=json.loads(request.content)
            self.assertEqual(str(request.url),'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
            self.assertEqual(request.headers['Authorization'],'Bearer '+KEY)
            raw=base64.b64decode(body['input']['messages'][0]['content'][0]['image'].split(',')[1])
            self.assertNotIn(b'PRIVATE_SYNTHETIC_METADATA',raw)
            with Image.open(BytesIO(raw)) as im:self.assertFalse(im.getexif())
            return httpx.Response(200,json={'request_id':'synthetic-id','output':{'choices':[{'message':{'content':[{'text':'broken '+KEY}]}}]}})
        with self.transport(handler),TestClient(create_app(ORIGIN)) as c:
            with c.websocket_connect('/cloud-studio',headers={'origin':ORIGIN}) as ws:
                self.send(ws,fixture());result=ws.receive_json();self.assertEqual(result['type'],'result');self.assertIsNone(result['result']);self.assertNotIn(KEY,result['repair_text']);self.assertEqual(ws.receive_json(),{'type':'done'})
        self.assertEqual(len(calls),1)

    def test_ark_no_reference_generation_is_one_provider_request(self):
        calls=[]
        def handler(request):
            calls.append(request);body=json.loads(request.content)
            self.assertEqual(str(request.url),'https://ark.cn-beijing.volces.com/api/v3/images/generations')
            self.assertEqual(body['size'],'2K');self.assertNotIn('image',body);self.assertEqual(body['response_format'],'b64_json')
            return httpx.Response(200,json={'id':'ark-fixture','data':[{'b64_json':base64.b64encode(fixture()).decode()}]})
        with self.transport(handler),TestClient(create_app(ORIGIN)) as c:
            with c.websocket_connect('/cloud-studio',headers={'origin':ORIGIN}) as ws:
                self.send(ws,b'',action='image',profile=PROFILE|{'provider':'ark-cn','vision_model':'','image_model':'doubao-seedream-4-0-250828'},prompt='synthetic')
                self.assertEqual(ws.receive_json()['request_id'],'ark-fixture');raw=ws.receive_bytes();self.assertEqual(ws.receive_json(),{'type':'done'})
                with Image.open(BytesIO(raw)) as im:self.assertFalse(im.getexif())
        self.assertEqual(len(calls),1)

    def test_origin_cancel_and_bad_metadata_make_no_provider_request(self):
        calls=[]
        def handler(request):calls.append(request);raise AssertionError('No generation authorized')
        with self.transport(handler),TestClient(create_app(ORIGIN)) as c:
            with self.assertRaises(WebSocketDisconnect):
                with c.websocket_connect('/cloud-studio',headers={'origin':'https://invalid.example'}):pass
            with c.websocket_connect('/cloud-studio',headers={'origin':ORIGIN}) as ws:
                ws.send_json(dict(action='image',profile=PROFILE,api_key=KEY,image_size=0));ws.send_json({'type':'cancel'});self.assertEqual(ws.receive_json()['type'],'error')
            with c.websocket_connect('/cloud-studio',headers={'origin':ORIGIN}) as ws:
                ws.send_json(dict(action='image',profile=PROFILE,api_key=KEY+'\n',image_size=0));error=ws.receive_json();self.assertEqual(error['type'],'error');self.assertNotIn(KEY,json.dumps(error))
        self.assertEqual(calls,[])

    def test_provider_timeout_never_retries_or_echoes_secret(self):
        calls=[]
        def handler(request):calls.append(request);raise httpx.ReadTimeout(KEY,request=request)
        with self.transport(handler),TestClient(create_app(ORIGIN)) as c:
            with c.websocket_connect('/cloud-studio',headers={'origin':ORIGIN}) as ws:
                self.send(ws,b'',action='image',prompt='synthetic');error=ws.receive_json();self.assertEqual(error['type'],'error');self.assertNotIn(KEY,json.dumps(error))
        self.assertEqual(len(calls),1)
