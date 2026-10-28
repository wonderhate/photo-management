import hashlib,subprocess,os
import pytest
from backend.app.services import lut_folder_service as folders
from test_lut_library import SOURCE

@pytest.mark.skipif(os.name!='nt',reason='Windows Explorer integration')
def test_reveal_only_registered_unchanged_lut_sources_and_never_writes_them(client,tmp_path,monkeypatch):
    root=tmp_path/'source';root.mkdir();source=root/'Original.cube';source.write_bytes(SOURCE);before=hashlib.sha256(SOURCE).hexdigest()
    folder=folders.scan(folders.register(str(root))['id']);asset=folder['entries'][0]['asset'];calls=[]
    monkeypatch.setattr(subprocess,'Popen',lambda args,**kw:calls.append((args,kw)))
    assert client.post('/api/editor/luts/'+asset['id']+'/reveal').status_code==200
    assert calls[0][0]==['explorer.exe','/select,',str(source)]
    assert calls[0][1]['creationflags']==subprocess.CREATE_NO_WINDOW
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    source.write_bytes(b'# changed\n'+SOURCE)
    assert client.post('/api/editor/luts/'+asset['id']+'/reveal').status_code==409
    assert len(calls)==1
    folders.remove(folder['id']);source.write_bytes(SOURCE)
    assert client.post('/api/editor/luts/'+asset['id']+'/reveal').status_code==409
    assert client.post('/api/editor/luts/'+'0'*64+'/reveal').status_code==409
    assert len(calls)==1 and source.read_bytes()==SOURCE

def test_lut_all_fold_preferences_persist_without_changing_other_fields(client):
    identity=client.get('/api/workspace').json()['library_id']
    def patch(value):return client.patch('/api/workspace/tools/lut',json={'library_id':identity,'values':value})
    assert patch({'treeExpanded':True,'fold:library:Pack':False,'strength':.5}).status_code==200
    assert patch({'treeExpanded':False,'fold:library:Pack':False}).json()['strength']==.5
    assert patch({'treeExpanded':1}).status_code==422
    saved=client.get('/api/workspace').json()['tool_preferences']['lut'];assert saved['treeExpanded'] is False and saved['strength']==.5

def test_lut_special_group_folds_merge_and_reject_invalid_or_stale_writes(client):
    identity=client.get('/api/workspace').json()['library_id']
    def patch(value,library=identity):return client.patch('/api/workspace/tools/lut',json={'library_id':library,'values':value})
    assert patch({'collapse:favorite':True,'collapse:recent':False,'strength':.7,'fold:library:Pack':True}).status_code==200
    assert patch({'collapse:recent':True}).json()['collapse:favorite'] is True
    for value in [{'collapse:unknown':True},{'collapse:favorite':1},{'collapse:recent':'true'}]:assert patch(value).status_code==422
    assert patch({'collapse:favorite':False},'other-library').status_code==409
    saved=client.get('/api/workspace').json()['tool_preferences']['lut']
    assert saved['collapse:favorite'] and saved['collapse:recent'] and saved['fold:library:Pack'] and saved['strength']==.7
