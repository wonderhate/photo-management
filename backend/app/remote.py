"""Opt-in paired access to the same desktop library."""
from hashlib import sha256
from ipaddress import ip_address, ip_network
import json
import secrets
import socket
import threading
import time
from urllib.parse import urlsplit
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


def public_hosts(config: dict) -> set[str]:
    return {urlsplit(address).hostname or '' for address in config.get('public_addresses', [])}


def is_public_host(request: Request, config: dict | None = None) -> bool:
    return (request.url.hostname or '') in public_hosts(config if config is not None else read_config())


def public_origin(request: Request, origin: str) -> bool:
    parts = urlsplit(origin or '')
    return parts.scheme == 'https' and bool(parts.hostname) and parts.hostname == request.url.hostname and is_public_host(request)


def normalize_public_address(raw: str) -> str:
    parts = urlsplit(raw.strip())
    host = parts.hostname or ''
    if parts.scheme != 'https' or not host or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ('', '/'):
        raise ValueError('公网地址必须是完整的 https:// 地址，不含路径，例如 https://photos.example.com')
    try:
        address = ip_address(host)
    except ValueError:
        address = None
    if host in LOCAL_HOSTS or (address is not None and (address.is_private or address in ip_network('100.64.0.0/10'))):
        raise ValueError('公网地址须为公网可访问的域名或 IP')
    literal = f'[{host}]' if ':' in host else host
    return f'https://{literal}' + (f':{parts.port}' if parts.port and parts.port != 443 else '')


def guard(request: Request) -> Response | None:
    host = request.url.hostname
    config = None
    try:
        address = ip_address(host or '')
        valid_host = (address.is_private or address in ip_network('100.64.0.0/10')) and not address.is_unspecified and not address.is_multicast
    except ValueError:
        config = read_config()
        valid_host = host in LOCAL_HOSTS or host in public_hosts(config)
    if not valid_host:
        return JSONResponse({'detail': '无效的电脑访问地址'}, status_code=400)
    if local_request(request):
        return None
    config = config if config is not None else read_config()
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


class PublicAddress(BaseModel):
    address: str = Field(max_length=300)


@router.get('/settings')
def get_settings(request: Request):
    require_local(request)
    config = read_config()
    addresses = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = ip_address(info[4][0])
            if (address.is_private or address in ip_network('100.64.0.0/10')) and not address.is_loopback and not address.is_link_local and not address.is_unspecified and not address.is_multicast:
                addresses.add(str(address))
    except OSError:
        pass
    port = request.url.port or 80
    return {'enabled': bool(config.get('enabled')), 'pairing_code': config.get('code', ''),
            'pairing_expires': config.get('pairing_expires', 0),
            'addresses': [f'http://{address}:{port}' for address in sorted(addresses)],
            'public_addresses': sorted(config.get('public_addresses', [])),
            'devices': sum(expiry > time.time() for expiry in config.get('sessions', {}).values())}


@router.put('/settings')
def update_settings(payload: AccessSettings, request: Request):
    require_local(request)
    with lock:
        write_config({'enabled': payload.enabled, 'code': f'{secrets.randbelow(100_000_000):08d}' if payload.enabled else '',
                      'pairing_expires': time.time() + 600 if payload.enabled else 0, 'sessions': {},
                      'public_addresses': read_config().get('public_addresses', []),
                      'pairing_failures': 0, 'pairing_locked_until': 0})
    return get_settings(request)


@router.post('/public-addresses')
def add_public_address(payload: PublicAddress, request: Request):
    require_local(request)
    address = normalize_public_address(payload.address)
    with lock:
        config = read_config()
        existing = config.get('public_addresses', [])
        if address in existing:
            raise HTTPException(409, '该公网地址已登记')
        if len(existing) >= 8:
            raise HTTPException(409, '公网地址过多，请先删除不再使用的地址')
        config['public_addresses'] = existing + [address]
        write_config(config)
    return get_settings(request)


@router.delete('/public-addresses')
def remove_public_address(address: str, request: Request):
    require_local(request)
    with lock:
        config = read_config()
        config['public_addresses'] = [item for item in config.get('public_addresses', []) if item != address]
        write_config(config)
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
        if config.get('pairing_locked_until', 0) > now:
            raise HTTPException(429, '配对码失败次数过多，请在电脑设置页生成新配对码')
        if not config.get('enabled') or config.get('pairing_expires', 0) <= now or not secrets.compare_digest(payload.code, config.get('code', '')):
            failures = config.get('pairing_failures', 0) + 1
            config['pairing_failures'] = failures
            if failures >= 10:
                config['pairing_locked_until'] = now + 900
            write_config(config)
            raise HTTPException(401, '配对码无效或已过期，请在电脑设置页生成新码')
        token = secrets.token_urlsafe(32)
        sessions = {key: expiry for key, expiry in config.get('sessions', {}).items() if expiry > now}
        if len(sessions) >= 16:
            raise HTTPException(409, '已配对设备过多，请在电脑端重新生成配对码')
        sessions[sha256(token.encode()).hexdigest()] = now + 30 * 86400
        config['sessions'] = sessions
        config['pairing_failures'] = 0
        write_config(config)
    response.set_cookie(COOKIE, token, max_age=30 * 86400, httponly=True, samesite='strict',
                        secure=request.url.scheme == 'https' or is_public_host(request, config))
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
