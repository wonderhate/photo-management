from hashlib import sha256
from PIL import Image
from backend.app.services import file_actions, import_service


def test_capability_probe_survives_pythonnet_loaded_module(monkeypatch):
    import sys
    import types
    monkeypatch.setitem(sys.modules,'clr',types.ModuleType('clr'))
    assert file_actions.supported() == (file_actions.os.name == 'nt')


def test_drag_requires_a_ready_desktop_window(client,tmp_path,monkeypatch):
    monkeypatch.setattr(file_actions,'_native_drag',None)
    source=tmp_path/'source.png';Image.new('RGB',(40,30),'red').save(source)
    _,id=import_service.import_one(source);before=sha256(source.read_bytes()).hexdigest()
    assert client.get('/api/file-actions/capabilities').json()['drag'] is False
    assert client.post('/api/file-actions',json={'photo_ids':[id],'action':'drag'}).status_code==501
    assert sha256(source.read_bytes()).hexdigest()==before


def test_desktop_bridge_resolves_ids_and_recovers_from_cancel_and_errors(client,tmp_path,monkeypatch):
    import pytest
    from fastapi import HTTPException
    source=tmp_path/'registered.png';Image.new('RGB',(40,30),'red').save(source)
    _,id=import_service.import_one(source);before=sha256(source.read_bytes()).hexdigest()
    monkeypatch.setattr(file_actions,'supported',lambda:True)
    calls=[]
    def bridge(paths):
        calls.append(paths)
        if len(calls)==2:raise HTTPException(503,'Synthetic transfer failure')
        return {'status':'cancelled' if len(calls)==1 else 'copied','count':len(paths),'effect':'copy'}
    monkeypatch.setattr(file_actions,'_native_drag',bridge)
    assert client.get('/api/file-actions/capabilities').json()['drag'] is True
    payload={'photo_ids':[id,id],'action':'drag'}
    assert client.post('/api/file-actions',json=payload).json()['status']=='cancelled'
    assert client.post('/api/file-actions',json=payload).status_code==503
    assert client.post('/api/file-actions',json=payload).json()['status']=='copied'
    assert calls==[[str(source.resolve())]]*3
    with pytest.raises(HTTPException) as invalid:file_actions.transfer([str(source)],'move')
    assert invalid.value.status_code==422
    assert sha256(source.read_bytes()).hexdigest()==before


def test_concurrent_transfer_is_rejected_without_starting_second_drag(monkeypatch):
    import pytest
    from fastapi import HTTPException
    monkeypatch.setattr(file_actions,'supported',lambda:True)
    monkeypatch.setattr(file_actions,'_native_drag',lambda paths:None)
    file_actions._transfer_lock.acquire()
    try:
        with pytest.raises(HTTPException) as busy:file_actions.transfer(['unused'],'drag')
        assert busy.value.status_code==409
    finally:file_actions._transfer_lock.release()


def test_file_transfer_uses_only_registered_records_and_copy_actions(client,tmp_path,monkeypatch):
    source=tmp_path/'source.jpg';Image.new('RGB',(40,30),'red').save(source)
    _,id=import_service.import_one(source);before=sha256(source.read_bytes()).hexdigest();calls=[]
    monkeypatch.setattr(file_actions,'transfer',lambda paths,action:calls.append((paths,action)) or {'status':'copied','effect':'copy','count':len(paths)})
    assert client.post('/api/file-actions',json={'photo_ids':[id],'action':'copy'}).status_code==200
    assert calls==[([str(source.resolve())],'copy')]
    for payload in [{'photo_ids':[id],'action':'move'},{'photo_ids':[id],'action':'copy','path':str(source)},{'photo_ids':['missing'],'action':'copy'},{'photo_ids':[],'action':'copy'}]:
        assert client.post('/api/file-actions',json=payload).status_code in (404,422)
    assert len(calls)==1 and sha256(source.read_bytes()).hexdigest()==before
