"""Final migration gate: synthetic libraries, faults, immutable originals."""
import errno
from contextlib import closing
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
import sqlite3
import pytest
from backend import migrate_storage as copy
from backend.app import migrations


def library(folder):
    folder.mkdir()
    original=folder.parent/'external-original.jpg'
    original.write_bytes(b'synthetic immutable original')
    with sqlite3.connect(folder/'library.db') as db:
        db.execute('CREATE TABLE photos(id TEXT PRIMARY KEY,file_path TEXT,source_directory TEXT,thumbnail_path TEXT,preview_path TEXT)')
        db.execute('INSERT INTO photos VALUES (?,?,?,?,?)',('synthetic',str(original),str(original.parent),None,None))
    (folder/'settings.json').write_text('{"count_mode":"file"}','utf-8')
    (folder/'qwen-art-key.dpapi').write_bytes(b'synthetic-unreadable-user-bound-key')
    (folder/'ai-studio').mkdir()
    (folder/'ai-studio'/'synthetic.png').write_bytes(b'synthetic derived bytes')
    return original


def hashes(root):
    return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}


@pytest.mark.parametrize('failure',['disk_full','interrupted','corrupt_settings'])
def test_copy_failure_never_publishes_partial_library(tmp_path,monkeypatch,failure):
    source=tmp_path/'source';original=library(source);before=hashes(source);original_before=original.read_bytes()
    target=tmp_path/'destination-volume'/'library'
    real=copy.shutil.copy2
    def injected(src,dst,*args,**kwargs):
        result=real(src,dst,*args,**kwargs)
        if Path(src).name=='settings.json':
            if failure=='disk_full':raise OSError(errno.ENOSPC,'Synthetic full destination disk')
            if failure=='interrupted':raise KeyboardInterrupt('Synthetic interruption')
            Path(dst).write_bytes(b'changed during copy')
        return result
    with monkeypatch.context() as patch:
        patch.setattr(copy.shutil,'copy2',injected)
        with pytest.raises((OSError,KeyboardInterrupt,ValueError)):copy.migrate(source,target)
    assert not target.exists() and not list(target.parent.glob('.photo-library-copy-*'))
    assert hashes(source)==before and original.read_bytes()==original_before
    copy.migrate(source,target)
    assert (target/'settings.json').read_bytes()==(source/'settings.json').read_bytes()
    assert (target/'qwen-art-key.dpapi').read_bytes()==(source/'qwen-art-key.dpapi').read_bytes()
    assert hashes(source)==before and original.read_bytes()==original_before


def test_backup_disk_full_preserves_database_and_has_no_valid_named_backup(tmp_path,monkeypatch):
    source=tmp_path/'source';library(source);database=source/'library.db';before=database.read_bytes()
    original_connect=sqlite3.connect
    class InterruptedBackup(sqlite3.Connection):
        def backup(self,target,*args,**kwargs):
            target.execute('CREATE TABLE incomplete(id)');target.commit()
            raise OSError(errno.ENOSPC,'Synthetic disk full during sqlite backup')
    def connect(path,*args,**kwargs):
        if 'mode=ro' in str(path):kwargs['factory']=InterruptedBackup
        return original_connect(path,*args,**kwargs)
    monkeypatch.setattr(migrations.sqlite3,'connect',connect)
    with pytest.raises(OSError):migrations.migrate_database(database)
    assert database.read_bytes()==before
    assert list((source/'backups').iterdir())==[]


def test_backup_publication_does_not_overwrite_new_file(tmp_path,monkeypatch):
    source=tmp_path/'source';library(source);destination=tmp_path/'backup.db'
    original_connect=sqlite3.connect
    class RacingBackup(sqlite3.Connection):
        def backup(self,target,*args,**kwargs):
            super().backup(target,*args,**kwargs)
            destination.write_bytes(b'an unrelated file appeared')
    def connect(path,*args,**kwargs):
        if 'mode=ro' in str(path):kwargs['factory']=RacingBackup
        return original_connect(path,*args,**kwargs)
    monkeypatch.setattr(migrations.sqlite3,'connect',connect)
    with pytest.raises(FileExistsError):migrations.backup_database(source/'library.db',destination)
    assert destination.read_bytes()==b'an unrelated file appeared'
    assert not list(tmp_path.glob('.database-backup-*'))


def test_migrated_unreadable_dpapi_can_be_replaced_without_affecting_original(tmp_path,monkeypatch):
    from backend.app.services import art_credentials
    source=tmp_path/'source';original=library(source);before=hashes(source);original_before=original.read_bytes()
    target=tmp_path/'new-library';copy.migrate(source,target)
    monkeypatch.delenv('DASHSCOPE_API_KEY',raising=False)
    monkeypatch.setenv('OPENAI_API_KEY','must-never-be-used')
    monkeypatch.setattr(art_credentials,'KEY_FILE',target/'qwen-art-key.dpapi')
    real=art_credentials.protect
    def broken(value,decrypt=False):
        if decrypt:raise ValueError('Synthetic other-user DPAPI failure')
        return real(value,decrypt)
    with monkeypatch.context() as patch:
        patch.setattr(art_credentials,'protect',broken)
        assert art_credentials.status()['key_error'] and not art_credentials.status()['configured']
        with pytest.raises(ValueError):art_credentials.get_key()
    if art_credentials.os.name=='nt':
        art_credentials.save_key('synthetic-replacement-key-only')
        assert art_credentials.get_key()=='synthetic-replacement-key-only'
        assert b'synthetic-replacement-key-only' not in art_credentials.KEY_FILE.read_bytes()
    assert hashes(source)==before and original.read_bytes()==original_before


@pytest.mark.parametrize('name',['settings.json','qwen-art-key.dpapi'])
def test_migration_rejects_linked_settings_or_credentials(tmp_path,monkeypatch,name):
    source=tmp_path/'source';library(source);before=hashes(source)
    actual=copy.linked
    monkeypatch.setattr(copy,'linked',lambda p:p.name==name or actual(p))
    with pytest.raises(ValueError,match='link'):copy.migrate(source,tmp_path/'target')
    assert hashes(source)==before and not (tmp_path/'target').exists()


def test_managed_nested_exports_and_receipts_survive_two_moves(tmp_path,monkeypatch):
    from backend.app.services import export_registry
    from urllib.parse import unquote
    source=tmp_path/'source';library(source)
    exported=source/'exports'/'set-1'/'panel.png';exported.parent.mkdir(parents=True);exported.write_bytes(b'synthetic split output')
    monkeypatch.setattr(export_registry,'DATA',source)
    monkeypatch.setattr(export_registry,'EXPORTS',source/'exports')
    url=export_registry.register(exported)
    receipts=source/'export-records'/'splits';receipts.mkdir()
    receipt={'version':1,'request':{'group_id':'synthetic','directory':str(source/'exports'),'subfolder':True},
             'result':{'directory':str(exported.parent),'files':[{'file_name':exported.name,'url':url,'sha256':hashlib.sha256(exported.read_bytes()).hexdigest()}]}}
    (receipts/'synthetic.json').write_text(json.dumps(receipt),'utf-8')
    before=hashes(source);first=tmp_path/'first';last=tmp_path/'last'
    copy.migrate(source,first);copy.migrate(first,last)
    monkeypatch.setattr(export_registry,'DATA',last)
    monkeypatch.setattr(export_registry,'EXPORTS',last/'exports')
    name=unquote(url.rsplit('/',1)[-1]);moved=last/'exports'/'set-1'/'panel.png'
    assert export_registry.lookup(name)==moved
    saved=json.loads((last/'export-records'/'splits'/'synthetic.json').read_text('utf-8'))
    assert saved['request']['directory']==str(last/'exports') and saved['result']['directory']==str(moved.parent)
    assert saved['result']['files'][0]['url']==url and hashes(source)==before
    moved.write_bytes(b'tampered export')
    assert export_registry.lookup(name) is None
    record=export_registry.record_path(name);metadata=json.loads(record.read_text('utf-8'))
    metadata['file_path']=str(exported);record.write_text(json.dumps(metadata),'utf-8')
    assert export_registry.lookup(name)==exported  # Exact registered original URL remains independently valid.
    outside=tmp_path/'panel.png';outside.write_bytes(b'synthetic split output')
    metadata['file_path']=str(outside);record.write_text(json.dumps(metadata),'utf-8')
    assert export_registry.lookup(name) is None  # A migrated alias cannot authorize an unrelated path.


def test_hard_interruption_leaves_old_library_usable_and_allows_new_copy(tmp_path):
    source=tmp_path/'source';original=library(source);before=hashes(source);target=tmp_path/'target'
    script="""
import os,sys
from pathlib import Path
from backend import migrate_storage as m
real=m.shutil.copy2
def stop(src,dst,*a,**kw):
    result=real(src,dst,*a,**kw)
    if Path(src).name=='settings.json':os._exit(77)
    return result
m.shutil.copy2=stop
m.migrate(Path(sys.argv[1]),Path(sys.argv[2]))
"""
    result=subprocess.run([sys.executable,'-c',script,str(source),str(target)],timeout=30)
    assert result.returncode==77 and not target.exists() and hashes(source)==before
    assert list(tmp_path.glob('.photo-library-copy-*'))  # Incomplete stages stay visibly separate.
    copy.migrate(source,target)
    assert (target/'library.db').is_file() and hashes(source)==before and original.is_file()


def test_real_cross_volume_copy_preserves_sources(tmp_path):
    configured=os.environ.get('PHOTO_TEST_CROSS_VOLUME_ROOT')
    if not configured:pytest.skip('Set an isolated .test-artifacts directory on a different volume')
    root=Path(configured).resolve()
    assert root.is_absolute() and '.test-artifacts' in root.parts
    root.mkdir(parents=True,exist_ok=True)
    assert root.stat().st_dev!=tmp_path.stat().st_dev,'Cross-volume acceptance requires different volumes'
    source=tmp_path/'source';original=library(source);before=hashes(source)
    with tempfile.TemporaryDirectory(prefix='library-cross-volume-',dir=copy.native_path(root)) as folder:
        target=Path(folder)/'copied'
        copy.migrate(source,target)
        with closing(sqlite3.connect(target/'library.db')) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert db.execute('SELECT file_path FROM photos').fetchone()[0]==str(original)
        assert hashes(source)==before
        assert (target/'qwen-art-key.dpapi').read_bytes()==(source/'qwen-art-key.dpapi').read_bytes()
