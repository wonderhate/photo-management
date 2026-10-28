from backend.app.migrations import SCHEMA_VERSION
"""Split pixels, atomic publication, immutable lineage and real SQLite moves."""
import io
import json
import sqlite3
from copy import deepcopy
from pathlib import Path
from uuid import uuid4
import pytest
from PIL import Image
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as DatabaseSession
from backend.app.config import DATA
from backend.app.models import Session,EditDocument,AssetVariant
from backend.app import migrations
from backend.app.services import editor_service,split_service
from backend.app.split_schemas import SplitSpec,panel_boundaries,split_plan
from backend.library_maintenance import merge_libraries
from backend.migrate_storage import migrate
from test_editor import create_edit,create_variant,digest,NEUTRAL


def image_bytes(image,format='PNG'):
    stream=io.BytesIO();image.save(stream,format,quality=93);return stream.getvalue()


def prepare(client,tmp_path,format='png'):
    image=Image.new('RGBA',(101,37));image.putdata([((x*7)%256,(y*13)%256,(x+y)*3%256,(x*11+y*7)%256) for y in range(37) for x in range(101)])
    original=tmp_path/'原片.png';original.write_bytes(image_bytes(image));before=digest(original.read_bytes())
    parent=deepcopy(NEUTRAL);parent['crop']=dict(x=.1,y=.1,width=.8,height=.8)
    edit=create_edit(client,original,recipe=parent,decode_profile={'version':2,'extra_orientation':1})
    spec=dict(version=1,aspect=dict(width=101/3,height=37),count=3,region=dict(x=0,y=0,width=1,height=1),basis=dict(width=101,height=37),angle=0)
    plan=split_plan(SplitSpec.model_validate(spec));master=image_bytes(image);panels=[]
    for r in plan['panels']:
        piece=image.crop((r['x'],0,r['x']+r['width'],r['height']))
        if format=='jpg':
            bg=Image.new('RGB',piece.size,'white');bg.paste(piece,mask=piece.getchannel('A'));piece=bg
        panels.append(image_bytes(piece,'JPEG' if format=='jpg' else 'PNG'))
    payload=dict(request_id=str(uuid4()),document_id=edit['id'],document_revision=edit['revision'],source_hash=before,
        name='山海之间.png',spec=spec,format=format,quality=93,master_hash=digest(master),panel_hashes=[digest(p) for p in panels])
    return original,before,edit,payload,master,panels


def post(client,payload,master,panels):
    return client.post('/api/editor/splits',data={'payload':json.dumps(payload)},
        files=[('file',('master.png',master,'image/png'))]+[('panels',(f'panel-{i}',p,'application/octet-stream')) for i,p in enumerate(panels)])


def folders():return set((DATA/'assets'/'variants').glob('*'))


def test_shared_integer_edges_and_atomic_png_versions_remain_frozen_and_idempotent(client,tmp_path):
    contract=json.loads((Path(__file__).parents[2]/'frontend/tests/fixtures/split-contract.json').read_text())
    for row in contract['boundaries']:assert panel_boundaries(row['width'],row['count'])==row['edges']
    original,before,edit,payload,master,panels=prepare(client,tmp_path)
    response=post(client,payload,master,panels);assert response.status_code==201,response.text
    group=response.json();assert group['plan']['edges']==[0,34,67,101] and group['parent_recipe']==edit['recipe']
    assert group['recipe']['crop']==dict(x=0,y=0,width=1,height=1) and group['recipe']['version']==2
    assert len(group['panels'])==3 and client.get('/api/editor/variants').json()['total']==3
    whole=Image.open(io.BytesIO(master)).convert('RGBA');joined=Image.new('RGBA',whole.size)
    for index,panel in enumerate(group['panels']):
        data=client.get(panel['preview_url']).content;assert data==panels[index]
        assert panel['split']['index']==index and panel['split']['group_id']==group['id'] and panel['split']['source_hash']==before
        joined.paste(Image.open(io.BytesIO(data)),(group['plan']['edges'][index],0))
    assert joined.tobytes()==whole.tobytes() and digest(original.read_bytes())==before
    assert client.get('/api/photos').json()['total']==0
    changed=client.put('/api/editor/edits/'+edit['id'],json=dict(revision=1,source_hash=before,recipe=NEUTRAL|{'exposure':1}));assert changed.status_code==200
    assert post(client,payload,master,panels).json()==group
    assert client.get('/api/editor/splits/'+group['id']).json()==group
    assert client.get('/api/editor/splits',params={'document_id':group['document_id'],'page_size':1}).json()=={'items':[group],'total':1}
    assert client.get('/api/editor/splits',params={'document_id':group['document_id'],'page_size':1,'page':2}).json()=={'items':[],'total':1}
    assert client.get('/api/editor/splits',params={'document_id':'missing'}).status_code==404
    assert client.get('/api/editor/splits',params={'document_id':group['document_id'],'page':0}).status_code==422
    assert post(client,payload|{'quality':92},master,panels).status_code==409
    assert client.delete('/api/editor/edits/'+edit['id']).status_code==409
    with Session() as s:assert s.query(AssetVariant).count()==4 and s.get(EditDocument,edit['id']).recipe['exposure']==1


def test_split_jpeg_keeps_exact_encoder_bytes_geometry_and_original_hash(client,tmp_path):
    original,before,edit,payload,master,panels=prepare(client,tmp_path,'jpg');response=post(client,payload,master,panels)
    assert response.status_code==201,response.text
    group=response.json();assert group['format']=='jpg' and group['quality']==93
    for i,panel in enumerate(group['panels']):
        assert client.get(panel['preview_url']).content==panels[i]
        assert panel['width']==[34,33,34][i] and panel['height']==37 and panel['name'].endswith(f'{i+1:02}.jpg')
    assert digest(original.read_bytes())==before


def test_bad_geometry_hashes_dimensions_and_mixed_png_pixels_leave_no_partial_group(client,tmp_path):
    original,before,edit,payload,master,panels=prepare(client,tmp_path);start=folders()
    bad=[]
    for patch in [{'version':2},{'count':True},{'count':11},{'angle':5},{'basis':{'width':1,'height':100_000_001}}]:bad.append((payload|{'spec':payload['spec']|patch},master,panels))
    bad.extend([(payload|{'master_hash':'0'*64},master,panels),(payload|{'document_revision':2},master,panels),(payload|{'source_hash':'0'*64},master,panels),(payload,master,panels[:-1])])
    wrong=image_bytes(Image.new('RGBA',(34,37),(1,2,3,255)));bad.append((payload|{'panel_hashes':[digest(wrong),*payload['panel_hashes'][1:]]},master,[wrong,*panels[1:]]))
    for request,whole,parts in bad:
        result=post(client,request,whole,parts);assert result.status_code in (409,422),result.text
        assert folders()==start
        with Session() as s:assert s.query(AssetVariant).count()==0
    assert digest(original.read_bytes())==before


def test_mid_upload_failure_rolls_back_only_new_files_and_retry_succeeds(client,tmp_path,monkeypatch):
    original,before,edit,payload,master,panels=prepare(client,tmp_path);old=create_variant(client,edit);start=folders();upload=editor_service.upload_to;calls=0
    def fail(uploaded,target,limit):
        nonlocal calls
        calls+=1
        if calls==3:raise HTTPException(507,'Synthetic disk full')
        return upload(uploaded,target,limit)
    with monkeypatch.context() as patch:
        patch.setattr(editor_service,'upload_to',fail)
        assert post(client,payload,master,panels).status_code==507
    assert folders()==start and client.get(old['preview_url']).status_code==200
    with Session() as s:assert s.query(AssetVariant).count()==1
    assert post(client,payload,master,panels).status_code==201
    assert digest(original.read_bytes())==before


def test_late_source_change_and_other_process_revision_are_checked_before_publication(client,tmp_path,monkeypatch):
    original,before,edit,payload,master,panels=prepare(client,tmp_path);start=folders();upload=split_service._upload
    with Session() as s:source=Path(s.get(EditDocument,edit['id']).source_path)
    original_snapshot=source.read_bytes();calls=0
    def alter(*args):
        nonlocal calls
        result=upload(*args);calls+=1
        if calls==4:source.write_bytes(b'changed snapshot')
        return result
    with monkeypatch.context() as patch:
        patch.setattr(split_service,'_upload',alter)
        assert post(client,payload,master,panels).status_code==409
    assert folders()==start;source.write_bytes(original_snapshot)
    def revision(*args):
        result=upload(*args)
        with Session() as s:
            row=s.get(EditDocument,edit['id']);row.revision=2;s.commit()
        return result
    with monkeypatch.context() as patch:
        patch.setattr(split_service,'_upload',revision)
        assert post(client,payload,master,panels).status_code==409
    assert folders()==start
    with Session() as s:assert s.query(AssetVariant).count()==0 and s.get(EditDocument,edit['id']).revision==2
    assert digest(original.read_bytes())==before


def test_copy_merge_remaps_split_relationships_but_preserves_storage_ids_and_pixels(client,tmp_path):
    original,before,edit,payload,master,panels=prepare(client,tmp_path);result=post(client,payload,master,panels);assert result.status_code==201,result.text
    group=result.json();moved=tmp_path/'moved';migrate(DATA,moved)
    target=migrations.backup_database(DATA/'library.db',tmp_path/'target.db');incoming=migrations.backup_database(DATA/'library.db',tmp_path/'incoming.db');stage=tmp_path/'stage.db'
    merge_libraries(target,incoming,stage,tmp_path/'elsewhere',tmp_path/'new')
    for database,count in [(moved/'library.db',1),(stage,2)]:
        engine=create_engine(f'sqlite:///{database}')
        try:
            with DatabaseSession(engine) as s:
                masters=s.query(AssetVariant).filter_by(kind='split-master').all();assert len(masters)==count
                for row in masters:
                    restored=split_service.group_json(s,row);assert restored['source_hash']==before and restored['plan']==group['plan']
                    assert row.source_json['storage_id']==group['id']
                    assert restored['id']==row.id and restored['panels'][0]['document_id']==row.document_id
                    for i,p in enumerate(restored['panels']):assert editor_service.variant_path(s.get(AssetVariant,p['id'])).read_bytes()==panels[i]
        finally:engine.dispose()
    assert digest(original.read_bytes())==before


def test_future_or_damaged_lineage_cannot_be_loaded_or_republished(client,tmp_path):
    original,before,edit,payload,master,panels=prepare(client,tmp_path);group=post(client,payload,master,panels).json();first=group['panels'][0]
    with Session() as s:
        row=s.get(AssetVariant,first['id']);snapshot=deepcopy(row.source_json);row.source_json=deepcopy(snapshot)|{'split':snapshot['split']|{'version':2}};s.commit()
    assert client.get(first['preview_url']).status_code==409
    assert client.get('/api/editor/splits/'+group['id']).status_code==409
    assert post(client,payload,master,panels).status_code==409
    with Session() as s:assert s.query(AssetVariant).count()==4
    assert digest(original.read_bytes())==before


def test_schema14_backup_and_failed_backup_preserve_existing_edits(client,tmp_path,monkeypatch):
    original,before,edit,payload,master,panels=prepare(client,tmp_path);path=migrations.backup_database(DATA/'library.db',tmp_path/'legacy.db')
    with sqlite3.connect(path) as db:db.execute('PRAGMA user_version=14')
    protected=path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(migrations,'backup_database',lambda *args:(_ for _ in ()).throw(OSError('Synthetic backup failure')))
        with pytest.raises(OSError):migrations.migrate_database(path)
    assert path.read_bytes()==protected
    migrations.migrate_database(path);backups=list((tmp_path/'backups').glob('*.db'));assert len(backups)==1
    with sqlite3.connect(backups[0]) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==14 and db.execute('SELECT id FROM edit_documents').fetchone()[0]==edit['id']
    with sqlite3.connect(path) as db:assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION and db.execute('PRAGMA foreign_key_check').fetchall()==[]
    migrations.migrate_database(path);assert len(list((tmp_path/'backups').glob('*.db')))==1
    assert digest(original.read_bytes())==before
