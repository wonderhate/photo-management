"""Opt-in paired access to the same desktop library."""
from hashlib import sha256
from ipaddress import ip_address, ip_network
import json
import secrets
import socket
import threading
import time
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from .config import DATA

router = APIRouter(prefix='/api/remote')
CONFIG = DATA / 'remote-access.json'
COOKIE = 'photo_remote'
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1', 'testserver'}
lock = threading.RLock()
attempts: dict[str, list[float]] = {}


def read_config() -> dict:
    try:
        return json.loads(CONFIG.read_text('utf-8'))
    except (FileNotFoundError, ValueError):
        return {'enabled': False, 'sessions': {}}


def write_config(value: dict) -> None:
    temporary = CONFIG.with_suffix('.tmp')
    temporary.write_text(json.dumps(value), 'utf-8')
    temporary.replace(CONFIG)


def local_request(request: Request) -> bool:
    # Never trust forwarded IPs. Both launchers disable proxy headers.
    return request.url.hostname in LOCAL_HOSTS and (request.client.host if request.client else '') in {'127.0.0.1', '::1', 'testclient', 'testserver'}


def authenticated(request: Request, config: dict) -> bool:
    token = request.cookies.get(COOKIE, '')
    return bool(token and config.get('sessions', {}).get(sha256(token.encode()).hexdigest(), 0) > time.time())


def guard(request: Request) -> Response | None:
    host = request.url.hostname
    try:
        address = ip_address(host or '')
        valid_host = (address.is_private or address in ip_network('100.64.0.0/10')) and not address.is_unspecified and not address.is_multicast
    except ValueError:
        valid_host = host in LOCAL_HOSTS
    if not valid_host:
        return JSONResponse({'detail': '无效的电脑访问地址'}, status_code=400)
    if local_request(request):
        return None
    config = read_config()
    if not config.get('enabled'):
        return JSONResponse({'detail': '电脑尚未开启手机远程访问'}, status_code=403)
    if request.url.path == '/api/remote/connect' and request.method == 'POST':
        return None
    if not authenticated(request, config):
        return JSONResponse({'detail': '请重新配对电脑'}, status_code=401)
    return None


def require_local(request: Request) -> None:
    if not local_request(request):
        raise HTTPException(403, '请在电脑端管理配对与访问权限')


class AccessSettings(BaseModel):
    enabled: bool


class PairRequest(BaseModel):
    code: str = Field(pattern=r'^\d{8}$')


@router.get('/settings')
def get_settings(request: Request):
    require_local(request)
    config = read_config()
    addresses = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = ip_address(info[4][0])
            if address.is_private and not address.is_loopback and not address.is_link_local:
                addresses.add(str(address))
    except OSError:
        pass
    port = request.url.port or 80
    return {'enabled': bool(config.get('enabled')), 'pairing_code': config.get('code', ''),
            'pairing_expires': config.get('pairing_expires', 0),
            'addresses': [f'http://{address}:{port}' for address in sorted(addresses)],
            'devices': sum(expiry > time.time() for expiry in config.get('sessions', {}).values())}


@router.put('/settings')
def update_settings(payload: AccessSettings, request: Request):
    require_local(request)
    with lock:
        write_config({'enabled': payload.enabled, 'code': f'{secrets.randbelow(100_000_000):08d}' if payload.enabled else '',
                      'pairing_expires': time.time() + 600 if payload.enabled else 0, 'sessions': {}})
    return get_settings(request)


@router.post('/connect')
def connect(payload: PairRequest, request: Request, response: Response):
    peer = request.client.host if request.client else 'unknown'
    with lock:
        now = time.time()
        recent = [stamp for stamp in attempts.get(peer, []) if stamp > now - 60]
        # ponytail: process-local limiter; use a shared limiter if multi-worker hosting is added.
        if len(recent) >= 5:
            raise HTTPException(429, '配对尝试过多，请一分钟后再试')
        if len(attempts) > 1024:
            attempts.clear()
        attempts[peer] = recent + [now]
        config = read_config()
        if not config.get('enabled') or config.get('pairing_expires', 0) <= now or not secrets.compare_digest(payload.code, config.get('code', '')):
            raise HTTPException(401, '配对码无效或已过期，请在电脑设置页生成新码')
        token = secrets.token_urlsafe(32)
        sessions = {key: expiry for key, expiry in config.get('sessions', {}).items() if expiry > now}
        if len(sessions) >= 16:
            raise HTTPException(409, '已配对设备过多，请在电脑端重新生成配对码')
        sessions[sha256(token.encode()).hexdigest()] = now + 30 * 86400
        config['sessions'] = sessions
        write_config(config)
    response.set_cookie(COOKIE, token, max_age=30 * 86400, httponly=True, samesite='strict', secure=request.url.scheme == 'https')
    response.headers['Cache-Control'] = 'no-store'
    return {'connected': True, 'name': '光影集 · 电脑照片库'}


@router.post('/disconnect')
def disconnect(request: Request, response: Response):
    with lock:
        config = read_config()
        config.get('sessions', {}).pop(sha256(request.cookies.get(COOKIE, '').encode()).hexdigest(), None)
        write_config(config)
    response.delete_cookie(COOKIE)
    return {'connected': False}


@router.get('/session')
def session(request: Request):
    return {'remote': not local_request(request) or 'PhotoCollectionRemote/' in request.headers.get('user-agent', ''),
            'name': '电脑照片库', 'image_cache': False}
