"""Pure collage output validation shared with cold library maintenance."""
from pathlib import Path
from . import collage_schemas as project

def save(v):
    project.exact(v,{'id','project_id','project_revision','page','format','quality','sha256'})
    if not project.matches(project.UUID,v['id']) or not project.matches(project.UUID,v['project_id']):raise ValueError('Invalid collage output.')
    if type(v['project_revision']) is not int or not 1<=v['project_revision']<=9007199254740991 or type(v['page']) is not int or not 0<=v['page']<240 or v['format'] not in ('png','jpg','webp') or type(v['quality']) is not int or not 1<=v['quality']<=100:raise ValueError('Invalid collage output.')
    import re
    if not isinstance(v['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',v['sha256']):raise ValueError('Invalid collage output.')

def scene(v):
    doc=v['project']['document']
    if doc['kind']=='single':
        if v['page']!=0:raise ValueError('Invalid collage output.')
        return doc['value']
    if v['page']>=len(doc['value']['pages']):raise ValueError('Invalid collage output.')
    return doc['value']['pages'][v['page']]

def record(v):
    project.exact(v,{'version','id','project','page','format','quality','sha256','width','height','created_at'})
    if type(v['version']) is not int or v['version']!=1:raise ValueError('Invalid collage output.')
    project.record(v['project']);save({k:v[k] for k in ('id','page','format','quality','sha256')}|{'project_id':v['project']['id'],'project_revision':v['project']['revision']})
    layout=scene(v)
    if type(v['width']) is not int or type(v['height']) is not int or (v['width'],v['height'])!=(layout['width'],layout['height']):raise ValueError('Invalid collage output.')
    from datetime import datetime
    if not isinstance(v['created_at'],str):raise ValueError('Invalid collage output.')
    datetime.fromisoformat(v['created_at'].replace('Z','+00:00'))

def stored(row_id,v,assets,path):
    record(v)
    if row_id!=v['id']:raise ValueError('Invalid collage output.')
    project.stored_record(v['project']['id'],v['project'],assets)
    p=Path(path)
    if not p.is_absolute() or p.name!=v['sha256']+'.'+v['format'] or p.parts[-4:-2]!=('documents','collage-outputs'):raise ValueError('Invalid collage output path.')
    if not project.matches(project.UUID,p.parent.name):raise ValueError('Invalid collage output path.')
    return p
