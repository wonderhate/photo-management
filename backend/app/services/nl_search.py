import re
from calendar import monthrange
from datetime import date, timedelta
from sqlalchemy import select
from ..models import Photo

STOPWORDS = ('的照片', '的相片', '照片', '相片', '拍的', '拍摄', '拍出', '用', '和', '与', '在', '里', '所有', '我', '看', '找', '一下')

def month_range(year: int, month: int) -> tuple[str, str]:
    return f'{year:04d}-{month:02d}-01', f'{year:04d}-{month:02d}-{monthrange(year, month)[1]:02d}'

def parse(query: str, session) -> dict:
    filters: dict[str, str] = {}
    interpreted: list[str] = []
    rest = query.strip()
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    spans = {
        '今天': (today, today, '今天'),
        '昨天': (today - timedelta(1), today - timedelta(1), '昨天'),
        '本周': (monday, today, '本周'), '这周': (monday, today, '本周'),
        '上周': (monday - timedelta(7), monday - timedelta(1), '上周'),
        '今年': (date(today.year, 1, 1), today, '今年'),
        '去年': (date(today.year - 1, 1, 1), date(today.year - 1, 12, 31), '去年'),
    }
    timed = False
    for word, (start, end, label) in spans.items():
        if word in rest:
            filters['date_from'], filters['date_to'] = start.isoformat(), end.isoformat()
            interpreted.append(label)
            rest = rest.replace(word, ' ')
            timed = True
            break
    if not timed:
        for word in ('上个月', '上月', '本月', '这个月'):
            if word in rest:
                if word in ('本月', '这个月'):
                    year, month, label = today.year, today.month, '本月'
                else:
                    year, month = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
                    label = '上个月'
                filters['date_from'], filters['date_to'] = month_range(year, month)
                interpreted.append(label)
                rest = rest.replace(word, ' ')
                timed = True
                break
    if not timed:
        match = re.search(r'(20\d{2})\s*年\s*(?:(\d{1,2})\s*月)?', rest)
        if match:
            year = int(match.group(1))
            if match.group(2):
                filters['date_from'], filters['date_to'] = month_range(year, int(match.group(2)))
                interpreted.append(f'{year} 年 {int(match.group(2))} 月')
            else:
                filters['date_from'], filters['date_to'] = f'{year}-01-01', f'{year}-12-31'
                interpreted.append(f'{year} 年')
            rest = rest.replace(match.group(0), ' ')
    match = re.search(r'(\d{2,3})\s*(?:mm|毫米)', rest, re.I)
    if match:
        filters['focal_length'] = match.group(1)
        interpreted.append(f'焦距 {match.group(1)}mm')
        rest = rest.replace(match.group(0), ' ')
    match = re.search(r'(?:f/|光圈)\s*(\d+(?:\.\d+)?)', rest, re.I)
    if match:
        filters['f_number'] = match.group(1)
        interpreted.append(f'光圈 f/{match.group(1)}')
        rest = rest.replace(match.group(0), ' ')
    match = re.search(r'(?:iso|感光度)\s*(\d+)', rest, re.I)
    if match:
        filters['iso'] = match.group(1)
        interpreted.append(f'ISO {match.group(1)}')
        rest = rest.replace(match.group(0), ' ')
    if re.search(r'\braw\b', rest, re.I):
        filters['file_type'] = 'raw'
        interpreted.append('仅 RAW')
        rest = re.sub(r'\braw\b', ' ', rest, flags=re.I)
    if '收藏' in rest:
        filters['favorite'] = 'true'
        interpreted.append('收藏')
        rest = rest.replace('收藏', ' ')
    if '竖' in rest:
        filters['orientation'] = 'portrait'
        interpreted.append('竖幅')
        rest = rest.replace('竖', ' ')
    elif '横' in rest:
        filters['orientation'] = 'landscape'
        interpreted.append('横幅')
        rest = rest.replace('横', ' ')
    leftover = rest
    for word in STOPWORDS:
        leftover = leftover.replace(word, ' ')
    leftover = leftover.strip()
    if leftover:
        cameras = session.scalars(select(Photo.camera_model).where(Photo.camera_model.is_not(None)).distinct()).all()
        lenses = session.scalars(select(Photo.lens_model).where(Photo.lens_model.is_not(None)).distinct()).all()
        lowered = leftover.lower()
        camera = next((c for c in cameras if lowered in c.lower() or c.lower() in lowered), None)
        lens = next((l for l in lenses if lowered in l.lower() or l.lower() in lowered), None)
        if camera:
            filters['camera_model'] = camera
            interpreted.append(f'相机 {camera}')
            leftover = re.sub(re.escape(camera),' ',leftover,flags=re.I).strip()
        elif lens:
            filters['lens_model'] = lens
            interpreted.append(f'镜头 {lens}')
            leftover = re.sub(re.escape(lens),' ',leftover,flags=re.I).strip()
        if leftover:
            filters['semantic'] = leftover
    return {'filters': filters, 'interpreted': interpreted, 'remaining_query': leftover, 'original_query':query}
