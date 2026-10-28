"""Display provenance for immutable LUTs; never resolve these groups as paths."""
import re

def validate_context(value):
    if type(value) is not dict or set(value)!={'groups','comments'}:raise ValueError('Invalid LUT source context.')
    groups=value['groups'];comments=value['comments']
    if type(groups) is not list or len(groups)>9 or any(type(s) is not str or not s.strip() or s in ('.','..') or len(s.encode('utf-16-le'))//2>255 or re.search(r'[\\/:\x00-\x1f\x7f]',s) for s in groups) or len('/'.join(groups).encode('utf-16-le'))//2>2048 or type(comments) is not list or len(comments)>32 or any(type(s) is not str or len(s.encode('utf-16-le'))//2>512 or re.search(r'[\x00-\x1f\x7f]',s) for s in comments):raise ValueError('Invalid LUT source context.')

def input_comments(text):
    return [re.sub(r'[\x00-\x1f\x7f]',' ',re.sub(r'^\s*#\s*','',l)).encode('utf-16-le')[:1024].decode('utf-16-le',errors='ignore') for l in re.split(r'\r\n|\r|\n',text) if re.match(r'^\s*#',l) and re.search(r'\binput\b',l,re.I)][:32]

def root_label(name):
    return ' · '.join(filter(None,re.split(r'[\\/:]+',name))).encode('utf-16-le')[:510].decode('utf-16-le',errors='ignore') or 'LUT'
