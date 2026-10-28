"""Map sources have explicit permissions; third-party scripts remain isolated."""
import asyncio
import json
import re
from pathlib import Path

import pytest
from fastapi import Request
from fastapi.responses import Response

from backend.app.main import SATELLITE_HEADERS, protect_local_requests


def https_policy_sources(policy):
    """Compare source lists for HTTPS hosting, not local HTTP documents.

    CSP3 6.7.2.8 resolves a scheme-less host using the protected origin's
    scheme. HTTPS cannot downgrade to HTTP (6.7.2.9). Keep the desktop
    policy explicit because its protected document is served over HTTP.
    """
    directives = {}
    for part in policy.split(';'):
        name, *sources = part.strip().split()
        assert name not in directives
        directives[name] = tuple(
            'https://' + source if re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', source) else source
            for source in sources
        )
    return directives


def response_headers(path):
    request = Request({
        'type': 'http', 'method': 'GET', 'path': path, 'raw_path': path.encode(),
        'scheme': 'http', 'server': ('127.0.0.1', 8000),
        'headers': [], 'query_string': b'',
    })

    async def next_response(_request):
        return Response('synthetic public document', media_type='text/html')

    return asyncio.run(protect_local_requests(request, next_response)).headers


@pytest.mark.parametrize('path', SATELLITE_HEADERS)
def test_satellite_response_matches_public_host_policy(path):
    actual = response_headers(path)
    assert actual['X-Frame-Options'] == 'SAMEORIGIN'
    assert actual['Cross-Origin-Embedder-Policy'] == 'unsafe-none'
    assert actual['Referrer-Policy'] == 'strict-origin-when-cross-origin'
    policy = actual['Content-Security-Policy']
    assert "frame-ancestors 'self'" in policy
    assert "connect-src 'self'" not in policy  # No local-library API access.
    assert 'https://maps.googleapis.com' in policy
    assert 'https://khms3.googleapis.com' in policy
    assert '*' not in policy  # No broad Google-host wildcards.
    root = Path(__file__).resolve().parents[2]
    for file in (root / 'edgeone.json', root / 'web' / 'edgeone.json'):
        rules = json.loads(file.read_text(encoding='utf-8'))['headers']
        rule = next(rule for rule in rules if rule['source'] == path)
        expected = {header['key']: header['value'] for header in rule['headers']}
        for name, value in SATELLITE_HEADERS[path].items():
            if file.parent.name == 'web' and name == 'Content-Security-Policy':
                assert len(expected[name]) <= 1000  # EdgeOne response-header value limit.
                assert https_policy_sources(expected[name]) == https_policy_sources(value)
            else:
                assert expected[name] == value
            assert actual[name] == value


@pytest.mark.parametrize('path', [
    '/', '/api/health', '/maps/land-110m.json', '/maps/satellite.html/',
    '/maps/satellite.js.backup', '/maps/another.html',
])
def test_other_responses_retain_local_only_and_isolation_policy(path):
    headers = response_headers(path)
    assert headers['X-Frame-Options'] == 'DENY'
    assert headers['Cross-Origin-Embedder-Policy'] == 'require-corp'
    assert headers['Cross-Origin-Opener-Policy'] == 'same-origin'
    assert headers['Referrer-Policy'] == 'no-referrer'
    policy = headers['Content-Security-Policy']
    assert "frame-src 'self'" in policy
    assert "frame-ancestors 'none'" in policy
    assert 'google' not in policy
    assert 'unsafe-eval' not in policy
    assert "script-src 'self';" in policy
    assert 'https://ibasemaps-api.arcgis.com' in policy
    assert 'https://api.maptiler.com' in policy
    assert '*' not in policy
