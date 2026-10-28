from collections import Counter, defaultdict
from calendar import monthrange
from datetime import date, datetime, timedelta
from math import log, sqrt
from sqlalchemy import select, func
from ..models import Session, Photo
from ..config import settings
from .library_service import query_photos
from .exif_service import shutter
from .analysis_scope import period, counting

FIELDS = ['id', 'date_taken', 'camera_model', 'lens_model', 'focal_length', 'f_number', 'iso', 'exposure_seconds']
APERTURES = [1, 1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32, 45, 64]

def rows(filters: dict, count_mode: str, lens: str | None = None) -> list[dict]:
    q = query_photos(filters, count_mode).with_only_columns(*(getattr(Photo, f) for f in FIELDS))
    if lens is not None:q=q.where(Photo.lens_model==lens)
    with Session() as session:
        return [dict(r) for r in session.execute(q).mappings()]

def common(data: list[dict], field: str):
    count = Counter(r[field] for r in data if r[field] is not None)
    return count.most_common(1)[0][0] if count else None

def histogram(data: list[dict], field: str, mode: str = 'grouped') -> list[dict]:
    n = len(data)
    bins: list[tuple[str, dict]] = []
    if mode == 'exact' or field in ('camera_model', 'lens_model'):
        values = sorted({r[field] for r in data if r[field] is not None})
        for value in values:
            label = str(value)
            if field == 'focal_length': label = f'{value:g} mm'
            if field == 'f_number': label = f'f/{value:g}'
            if field == 'iso': label = f'ISO {value}'
            if field == 'exposure_seconds': label = f'{shutter(value)} s'
            bins.append((label, {field: value}))
    elif field == 'focal_length':
        boundaries = [(None, 16, '< 16 mm'), (16, 25, '16–24 mm'), (25, 36, '25–35 mm'),
                      (36, 51, '36–50 mm'), (51, 86, '51–85 mm'), (86, 136, '86–135 mm'),
                      (136, 201, '136–200 mm'), (201, None, '> 200 mm')]
        bins = [(label, ({field + '_min': low} if low is not None else {}) | ({field + '_lt': high} if high is not None else {})) for low, high, label in boundaries]
    elif field == 'iso':
        previous = 0
        for high in [100, 200, 400, 800, 1600, 3200, 6400]:
            bins.append((f'ISO {previous + 1}–{high}', {field + '_gt': previous, field + '_max': high}))
            previous = high
        bins.append(('ISO > 6400', {field + '_gt': 6400}))
    elif field == 'f_number':
        for i, value in enumerate(APERTURES):
            low = sqrt(APERTURES[i - 1] * value) if i else 0
            high = sqrt(value * APERTURES[i + 1]) if i < len(APERTURES) - 1 else None
            bins.append((f'f/{value:g}', {field + '_min': low} | ({field + '_lt': high} if high else {})))
    elif field == 'exposure_seconds':
        edges = [1, 1/15, 1/60, 1/125, 1/250, 1/500, 1/1000]
        bins.append(('≥ 1 s', {field + '_min': 1}))
        for i in range(len(edges) - 1):
            bins.append((f'{shutter(edges[i])}–{shutter(edges[i+1])} s', {field + '_lt': edges[i], field + '_min': edges[i+1]}))
        bins.append(('< 1/1000 s', {field + '_lt': 1/1000}))
    result = []
    def matches(row: dict, condition: dict) -> bool:
        v = row[field]
        if v is None: return False
        for key, target in condition.items():
            if key == field and v != target: return False
            if key.endswith('_min') and v < target: return False
            if key.endswith('_max') and v > target: return False
            if key.endswith('_lt') and v >= target: return False
            if key.endswith('_gt') and v <= target: return False
        return True
    for label, condition in bins:
        count = sum(matches(r, condition) for r in data)
        if count or field not in ('f_number', 'camera_model', 'lens_model'):
            result.append(dict(label=label, count=count, percent=round(count / n * 100, 1) if n else 0, filter=condition))
    if field in ('lens_model', 'camera_model'):
        result.sort(key=lambda r: -r['count'])
    return result

def summarize(data: list[dict]) -> dict:
    dates = [r['date_taken'][:10] for r in data if r['date_taken']]
    days, months = Counter(dates), Counter(d[:7] for d in dates)
    return dict(total=len(data), cameras=len({r['camera_model'] for r in data if r['camera_model']}),
                lenses=len({r['lens_model'] for r in data if r['lens_model']}), shooting_days=len(days), shooting_months=len(months),
                common_lens=common(data, 'lens_model'), common_focal=common(data, 'focal_length'),
                common_aperture=common(data, 'f_number'), common_iso=common(data, 'iso'),
                common_shutter=shutter(common(data, 'exposure_seconds')),
                active_day=days.most_common(1)[0] if days else None,
                active_month=months.most_common(1)[0] if months else None,
                unknown_date=sum(not r['date_taken'] for r in data))

def statistics(filters: dict, count_mode: str, mode: str = 'grouped') -> dict:
    data = rows(filters, count_mode)
    return dict(summary=summarize(data), charts={field: histogram(data, field, mode) for field in
                ['focal_length', 'f_number', 'iso', 'exposure_seconds']})

def report(year: int, month: int | None, filters: dict, count_mode: str) -> dict:
    start = date(year, month or 1, 1)
    end = date(year + 1, 1, 1) if not month or month == 12 else date(year, month + 1, 1)
    period_filter = period(filters,start.isoformat(),(end - timedelta(days=1)).isoformat())
    data = rows(period_filter, count_mode)
    summary = summarize(data)
    summary['files'] = len(rows(counting(period_filter,'file'), 'file'))
    summary['captures'] = len(rows(counting(period_filter,'capture'), 'capture'))
    lenses = histogram(data, 'lens_model', 'exact')
    timeline = []
    keys = [f'{year}-{m:02}' for m in range(1, 13)] if month is None else [(start + timedelta(days=i)).isoformat() for i in range((end-start).days)]
    bands = settings()['focal_bands']
    band_names = [f'< {bands[0]}mm'] + [f'{a}–{b}mm' for a, b in zip(bands[:-1], bands[1:])] + [f'> {bands[-1]}mm']
    narratives = []
    for key in keys:
        subset = [r for r in data if r['date_taken'] and r['date_taken'].startswith(key)]
        lens_counts = Counter(r['lens_model'] for r in subset if r['lens_model'])
        band_counts = Counter()
        for row in subset:
            value = row['focal_length']
            if value is not None:
                index = 0 if value < bands[0] else None
                if index is None:
                    index = next((i for i, edge in enumerate(bands) if i > 0 and value <= edge), len(bands))
                band_counts[band_names[index]] += 1
        focal_total = sum(band_counts.values())
        timeline.append(dict(period=key, count=len(subset), lenses=dict(lens_counts), focal_bands=dict(band_counts),
                             focal_percent={k: round(v / focal_total * 100, 1) for k, v in band_counts.items()}))
        if subset and band_counts:
            top, count = band_counts.most_common(1)[0]
            narratives.append(f'{key}：{top} 使用最多，{count} 次，占已知焦段 {count / focal_total:.0%}。')
    zoom_bins = [(24, 29), (29, 36), (36, 51), (51, 61), (61, 71)]
    zoom = [dict(label=f'{a}–{b-1} mm', count=sum(r['focal_length'] is not None and a <= r['focal_length'] < b for r in data),
                 filter={'focal_length_min': a, 'focal_length_lt': b}) for a, b in zoom_bins]
    return dict(year=year, month=month, filters=period_filter, summary=summary, lenses=lenses, timeline=timeline,
                narratives=narratives, focal_bands=band_names, zoom=zoom,
                charts={f: histogram(data, f) for f in ['focal_length', 'f_number', 'iso', 'exposure_seconds']},
                cover_id=data[0]['id'] if data else None)

def lens_lifecycle(name: str, count_mode: str, filters: dict | None = None) -> dict:
    data = rows(filters or {}, count_mode, name)
    days = sorted({r['date_taken'][:10] for r in data if r['date_taken']})
    today = date.today()
    recent = today.replace(year=today.year - 1, day=min(today.day, monthrange(today.year-1,today.month)[1])).isoformat()
    months = Counter(r['date_taken'][:7] for r in data if r['date_taken'])
    gaps = [(date.fromisoformat(b)-date.fromisoformat(a)).days for a,b in zip(days, days[1:])]
    if days:
        gaps.append(max(0, (today-date.fromisoformat(days[-1])).days))
    return dict(lens=name, total=len(data), first_used=days[0] if days else None, last_used=days[-1] if days else None,
                past_12_months=sum(bool(r['date_taken']) and recent <= r['date_taken'][:10] <= today.isoformat() for r in data),
                busiest_month=months.most_common(1)[0] if months else None, longest_unused_days=max(gaps, default=0),
                summary=summarize(data))
