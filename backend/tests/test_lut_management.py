import hashlib
import pytest
from sqlalchemy.orm import Session as OrmSession
from backend.app.models import Session,LutAsset
from backend.app.services import lut_folder_service as folders
from test_lut_library import SOURCE,recipe
from test_editor import create_edit

def seed(client):
    return [client.post('/api/editor/luts',files={'file':(f'{i}.cube',f'# style {i}\n'.encode()+SOURCE)}).json() for i in range(2)]

def test_bulk_lut_hide_restore_keeps_originals_old_edits_and_unpinned_external_files(client,tmp_path,image_factory):
    assets=seed(client);photo=image_factory('bulk-lut.jpg');before=photo.read_bytes();edit=create_edit(client,photo,recipe=recipe(assets[0]));client.patch('/api/editor/luts/'+assets[0]['id'],json={'favorite':True});client.post('/api/editor/luts/'+assets[0]['id']+'/used')
    root=tmp_path/'external';root.mkdir();source=root/'External.cube';source.write_bytes(b'# external\n'+SOURCE);folder=folders.scan(folders.register(str(root))['id']);external=folder['entries'][0]['asset'];raw=source.read_bytes()
    snapshots={a['id']:client.get('/api/editor/luts/'+a['id']+'/source').content for a in assets};original=client.get('/api/editor/luts').json()
    hidden=client.post('/api/editor/luts/library/visibility',json={'hidden':True});assert hidden.status_code==200 and hidden.json()['changed']==2;assert all(a['hidden'] for a in hidden.json()['assets'])
    assert client.post('/api/editor/luts/library/visibility',json={'hidden':True}).json()['changed']==0
    assert not next(a for a in client.get('/api/editor/luts').json() if a['id']==external['id'])['hidden']
    with Session() as s:assert s.get(LutAsset,external['id']) is None
    assert client.get('/api/editor/edits/'+edit['id']).json()['recipe']==edit['recipe']
    assert client.post('/api/editor/luts/library/visibility',json={'hidden':False}).json()['changed']==2
    assert client.get('/api/editor/luts').json()==original
    for asset_id,data in snapshots.items():assert client.get('/api/editor/luts/'+asset_id+'/source').content==data
    assert photo.read_bytes()==before and hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(raw).digest()

def test_bulk_lut_failure_rolls_back_every_hidden_flag(client,monkeypatch):
    seed(client);before=client.get('/api/editor/luts').json()
    with monkeypatch.context() as patch:
        def fail(_):raise OSError('synthetic bulk commit failure')
        patch.setattr(OrmSession,'commit',fail)
        with pytest.raises(OSError):client.post('/api/editor/luts/library/visibility',json={'hidden':True})
    assert client.get('/api/editor/luts').json()==before

def test_bulk_lut_visibility_validates_requests_and_handles_legacy_metadata(client):
    asset=seed(client)[0]
    with Session() as s:
        row=s.get(LutAsset,asset['id']);row.metadata_json={k:v for k,v in row.metadata_json.items() if k!='context'}|{'version':1};s.commit()
    for value in [None,1,'true']:assert client.post('/api/editor/luts/library/visibility',json={'hidden':value}).status_code==422
    assert client.post('/api/editor/luts/library/visibility',json={'hidden':True,'path':'bad'}).status_code==422
    result=client.post('/api/editor/luts/library/visibility',json={'hidden':True}).json();legacy=next(a for a in result['assets'] if a['id']==asset['id']);assert legacy['version']==1 and 'context' not in legacy and legacy['hidden']
