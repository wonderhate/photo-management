"""Refine analysis scopes without replacing a caller's existing restrictions."""
import json
from .query_scope import normalize


def period(filters, start, end):
    result = dict(filters)
    result['date_from'] = max(str(result.get('date_from') or start), start)
    result['date_to'] = min(str(result.get('date_to') or end)[:10], end)
    return result


def counting(filters, mode):
    result = dict(filters, count_mode=mode)
    if result.get('scope'):
        scope = normalize(result['scope'])
        scope['mode'] = mode
        result['scope'] = json.dumps(scope, ensure_ascii=False, separators=(',', ':'))
    return result
