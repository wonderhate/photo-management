"""Rebuildable FTS5 accelerator. Dirty/unsupported text always uses source data."""
import sqlite3
from threading import RLock
from weakref import WeakKeyDictionary
from sqlalchemy import select,table,column,or_,func
from .text_search import value,INDEXED_FIELDS

VERSION=2
_states=WeakKeyDictionary()
_lock=RLock()
_active=None
_fts=table('pc_photo_text',column('photo_id'),column('body'))
_dirty=table('pc_text_dirty',column('photo_id'))
_rows=table('pc_text_rows',column('rowid'),column('photo_id'),column('safe'))
TRIGGERS={
 'pc_text_photo_insert':"AFTER INSERT ON photos BEGIN INSERT OR IGNORE INTO pc_text_dirty VALUES(new.id); END",
 'pc_text_photo_update':"AFTER UPDATE OF id,file_name,camera_make,camera_model,lens_model,user_description,annotation,removed_at ON photos BEGIN INSERT OR IGNORE INTO pc_text_dirty VALUES(old.id); INSERT OR IGNORE INTO pc_text_dirty VALUES(new.id); END",
 'pc_text_photo_delete':"AFTER DELETE ON photos BEGIN INSERT OR IGNORE INTO pc_text_dirty VALUES(old.id); END",
 'pc_text_link_insert':"AFTER INSERT ON photo_tags BEGIN INSERT OR IGNORE INTO pc_text_dirty VALUES(new.photo_id); END",
 'pc_text_link_delete':"AFTER DELETE ON photo_tags BEGIN INSERT OR IGNORE INTO pc_text_dirty VALUES(old.photo_id); END",
 'pc_text_link_update':"AFTER UPDATE OF photo_id,tag_id ON photo_tags BEGIN INSERT OR IGNORE INTO pc_text_dirty VALUES(old.photo_id); INSERT OR IGNORE INTO pc_text_dirty VALUES(new.photo_id); END",
 'pc_text_tag_update':"AFTER UPDATE OF name ON tags BEGIN INSERT OR IGNORE INTO pc_text_dirty SELECT photo_id FROM photo_tags WHERE tag_id=new.id; END",
 'pc_text_tag_delete':"AFTER DELETE ON tags BEGIN INSERT OR IGNORE INTO pc_text_dirty SELECT photo_id FROM photo_tags WHERE tag_id=old.id; END",
}

def initialize(engine,force=False):
    with engine.begin() as c:
        c.exec_driver_sql('BEGIN IMMEDIATE')
        identity=c.exec_driver_sql('SELECT library_id FROM library_profile WHERE singleton=1').scalar()
        tables={r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'")}
        c.exec_driver_sql('CREATE TABLE IF NOT EXISTS pc_text_meta (id INTEGER PRIMARY KEY CHECK(id=1),library_id TEXT NOT NULL,version INTEGER NOT NULL)')
        c.exec_driver_sql('CREATE TABLE IF NOT EXISTS pc_text_dirty (photo_id TEXT PRIMARY KEY NOT NULL)')
        c.exec_driver_sql('CREATE TABLE IF NOT EXISTS pc_text_rows (rowid INTEGER PRIMARY KEY,photo_id TEXT UNIQUE NOT NULL,safe INTEGER NOT NULL DEFAULT 1)')
        old=c.exec_driver_sql('SELECT library_id,version FROM pc_text_meta WHERE id=1').first()
        installed={r[0] for r in c.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'")}
        reset=force or not old or tuple(old)!=(identity,VERSION) or not set(TRIGGERS)<=installed or not {'pc_photo_text','pc_text_rows','pc_text_dirty','pc_text_meta'}<=tables
        try:
            c.exec_driver_sql("CREATE VIRTUAL TABLE temp.pc_text_probe USING fts5(body,tokenize='trigram')")
            c.exec_driver_sql('DROP TABLE temp.pc_text_probe')
            if reset:c.exec_driver_sql('DROP TABLE IF EXISTS pc_photo_text')
            c.exec_driver_sql("CREATE VIRTUAL TABLE IF NOT EXISTS pc_photo_text USING fts5(photo_id UNINDEXED,body,tokenize='trigram')")
            available=True
        except Exception as error:
            if not isinstance(getattr(error,'orig',error),sqlite3.OperationalError):raise
            available=False
        if reset:
            for name in TRIGGERS:c.exec_driver_sql('DROP TRIGGER IF EXISTS '+name)
            c.exec_driver_sql('DELETE FROM pc_text_rows');c.exec_driver_sql('DELETE FROM pc_text_dirty')
            c.exec_driver_sql('INSERT OR IGNORE INTO pc_text_dirty SELECT id FROM photos WHERE removed_at IS NULL')
        for name,sql in TRIGGERS.items():c.exec_driver_sql('CREATE TRIGGER IF NOT EXISTS '+name+' '+sql)
        c.exec_driver_sql('INSERT OR REPLACE INTO pc_text_meta VALUES(1,?,?)',(identity,VERSION if available else 0))
    with _lock:_states[engine]=dict(available=available,error=None if available else '文字索引暂不可用，仍可按当前文字搜索。')

def _engine():
    from ..models import engine
    return engine

def _disable(engine):
    with _lock:_states[engine]=dict(available=False,error='文字索引需要重建，仍可按当前文字搜索。')

def candidate(field,op,needle):
    engine=_engine()
    if field not in INDEXED_FIELDS or op not in ('contains','icontains') or len(needle)<3 or not needle.strip():return None
    # Newer Unicode casing/expansions need not agree with SQLite's tokenizer.
    # Keep those searches exact by scanning; ASCII and basic CJK are accelerated.
    if op=='icontains' and any(not(c.isascii() or '\u4e00'<=c<='\u9fff') for c in needle):return None
    with _lock:enabled=(_states.get(engine) or {}).get('available',False)
    if not enabled:return None
    quoted='"'+needle.replace('"','""')+'"'
    try:
        with engine.connect() as c:
            c.exec_driver_sql('BEGIN')
            rows=c.exec_driver_sql('SELECT count(*) FROM pc_text_rows WHERE safe=1').scalar()
            indexed=c.exec_driver_sql('SELECT count(*) FROM pc_photo_text').scalar()
            if rows!=indexed:raise ValueError('Text index coverage changed')
            c.exec_driver_sql('SELECT rowid FROM pc_photo_text WHERE body MATCH ? LIMIT 1',(quoted,)).first()
    except Exception:
        _disable(engine);return None
    from ..models import Photo
    return or_(Photo.id.in_(select(_dirty.c.photo_id)),Photo.id.in_(select(_rows.c.photo_id).where(_rows.c.safe==0)),Photo.id.in_(select(_fts.c.photo_id).where(_fts.c.body.match(quoted))))

def batch(engine,limit=256):
    from ..models import Photo,PhotoTag,Tag
    with engine.begin() as c:
        # Acquire the writer before reading: a concurrent edit must remain dirty.
        c.exec_driver_sql('BEGIN IMMEDIATE')
        ids=[r[0] for r in c.exec_driver_sql('SELECT photo_id FROM pc_text_dirty ORDER BY rowid LIMIT ?',(limit,))]
        if not ids:return (0,0)
        c.exec_driver_sql('INSERT OR IGNORE INTO pc_text_rows(photo_id) VALUES(?)',[(v,) for v in ids])
        mapping={r.photo_id:r.rowid for r in c.execute(select(_rows).where(_rows.c.photo_id.in_(ids)))}
        photos=c.execute(select(Photo.id,Photo.file_name,Photo.camera_model,Photo.lens_model,Photo.camera_make,Photo.user_description,Photo.annotation).where(Photo.id.in_(ids),Photo.removed_at.is_(None))).mappings().all()
        tags={}
        for photo_id,name in c.execute(select(PhotoTag.photo_id,Tag.name).join(Tag).where(PhotoTag.photo_id.in_(ids))):tags.setdefault(photo_id,[]).append(name)
        c.exec_driver_sql('DELETE FROM pc_photo_text WHERE rowid=?',[(mapping[v],) for v in ids])
        inserts=[];unsafe=0
        for raw in photos:
            p=dict(raw);p['tags']=tags.get(p['id'],[]);body=value(p,'text')+' '+(p['user_description'] or '')+' '+(value(p,'ai_caption') or '')
            safe='\0' not in body and not any(0xd800<=ord(ch)<=0xdfff for ch in body)
            c.exec_driver_sql('UPDATE pc_text_rows SET safe=? WHERE photo_id=?',(int(safe),p['id']))
            if safe:inserts.append((mapping[p['id']],p['id'],body))
            else:unsafe+=1
        if inserts:c.exec_driver_sql('INSERT INTO pc_photo_text(rowid,photo_id,body) VALUES(?,?,?)',inserts)
        live={p['id'] for p in photos}
        removed=[(v,) for v in ids if v not in live]
        if removed:c.exec_driver_sql('DELETE FROM pc_text_rows WHERE photo_id=?',removed)
        c.execute(_dirty.delete().where(_dirty.c.photo_id.in_(ids)))
        return len(ids),unsafe

def status():
    from ..models import Photo
    engine=_engine()
    with _lock:state=dict(_states.get(engine) or dict(available=False,error='文字索引暂不可用，仍可按当前文字搜索。'))
    with engine.connect() as c:
        c.exec_driver_sql('BEGIN')
        total=c.scalar(select(func.count()).select_from(Photo).where(Photo.removed_at.is_(None)))
        dirty=c.exec_driver_sql('SELECT count(*) FROM pc_text_dirty').scalar()
        indexed=c.exec_driver_sql('SELECT count(*) FROM pc_text_rows r JOIN photos p ON p.id=r.photo_id WHERE p.removed_at IS NULL AND r.safe=1 AND NOT EXISTS(SELECT 1 FROM pc_text_dirty d WHERE d.photo_id=r.photo_id)').scalar() if state['available'] else 0
    from . import jobs
    job=jobs.get(_active) if _active else None
    return dict(state,total=total,pending=dirty,indexed=indexed,job_id=job['id'] if job and job['status'] in jobs.ACTIVE else None)

def run(job_id,full=False):
    from . import jobs
    engine=_engine()
    if full:initialize(engine,True)
    s=status()
    if not s['available']:raise ValueError(s['error'])
    remaining=s['pending'];jobs.update(job_id,total=remaining,current='')
    processed=0;skipped=0
    while processed<remaining:
        jobs.check(job_id);count,unsafe=batch(engine,min(256,remaining-processed))
        if not count:break
        processed+=count;skipped+=unsafe
        jobs.update(job_id,processed=processed,success=processed-skipped,skipped=skipped)

def schedule(full=False):
    global _active
    from . import jobs
    with _lock:
        current=jobs.get(_active) if _active else None
        if current and current['status'] in jobs.ACTIVE:return current
        s=status()
        if not full and (not s['available'] or not s['pending']):return None
        _active=jobs.submit('text-index',run,full,resource='io')['id']
        return jobs.get(_active)
