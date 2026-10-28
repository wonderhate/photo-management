"""Value contract shared with core/metadata.ts and language-neutral fixture vectors."""
from datetime import datetime
from fractions import Fraction
import math
import re


def number(value):
    try:
        if hasattr(value,'values'):value=value.values
        if isinstance(value,(list,tuple)):value=value[0]
        if hasattr(value,'num') and hasattr(value,'den'):result=float(value.num)/value.den
        else:result=float(Fraction(str(value).strip()))
        return result if math.isfinite(result) else None
    except (ValueError,ZeroDivisionError,TypeError,IndexError,OverflowError):return None


def shutter(seconds):
    if seconds is None or not math.isfinite(seconds) or seconds<=0:return None
    inverse=1/seconds
    if math.isfinite(inverse):
        nearest=math.floor(inverse+.5)
        if seconds<1 and 2<=nearest<=1_000_000_000 and abs(seconds-1/nearest)<=seconds*.02:return f'1/{nearest}'
    return re.sub(r'e([+-])0+(\d+)',r'e\1\2',f'{seconds:.6g}')


def date_string(value):
    if hasattr(value,'values'):value=str(value)
    if not isinstance(value,str):return None
    prefix=value.strip()[:19]
    if not re.fullmatch(r'(?:\d{4}:\d{2}:\d{2} |\d{4}-\d{2}-\d{2}[T ])\d{2}:\d{2}:\d{2}',prefix):return None
    for fmt in ('%Y:%m:%d %H:%M:%S','%Y-%m-%dT%H:%M:%S','%Y-%m-%d %H:%M:%S'):
        try:return datetime.strptime(prefix,fmt).isoformat()
        except ValueError:pass
    return None


def gps(value,reference,limit=180):
    if hasattr(value,'values'):value=value.values
    ref=reference.decode('ascii','ignore') if isinstance(reference,bytes) else str(reference or '').strip().upper()
    if isinstance(value,str):
        xmp=re.fullmatch(r'(\d+)\s*,\s*(\d+(?:\.\d*)?)\s*([NSEW])',value.strip(),re.I)
        if xmp:
            if ref and ref!=xmp[3].upper():return None
            ref=xmp[3].upper();value=(xmp[1],xmp[2],0)
    if ref and ref not in (('N','S') if limit==90 else ('E','W')):return None
    if isinstance(value,(list,tuple)):
        if len(value)!=3:return None
        parts=[number(v) for v in value]
        if any(v is None for v in parts):return None
        d,m,s=parts
        if not 0<=m<60 or not 0<=s<60:return None
        result=(-1 if d<0 else 1)*(abs(d)+m/60+s/3600)
    else:result=number(value)
    if result is None or abs(result)>limit:return None
    return -abs(result) if ref in ('S','W') else result
