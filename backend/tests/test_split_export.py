"""Directory exports use synthetic originals and immutable saved split assets."""
from pathlib import Path
from uuid import uuid4
import json
import pytest
from backend.app.config import DATA,EXPORTS
from backend.app.services import split_export_service as output,export_registry
from test_split import prepare,post,digest


def fixture(client,tmp_path,format='png'):
    original,before,edit,payload,master,panels=prepare(client,tmp_path,format)
    group=post(client,payload,master,panels).json()
    return original,before,group,panels


def export(client,group,folder=None,subfolder=True,request=None):
    return client.post('/api/editor/splits/'+group['id']+'/export',json={'request_id':request or str(uuid4()),'output_directory':str(folder) if folder is not None else None,'subfolder':subfolder})


@pytest.mark.parametrize('format',['png','jpg'])
@pytest.mark.parametrize('subfolder',[True,False])
def test_whole_group_directory_export_retains_exact_bytes_and_idempotent_receipts(client,tmp_path,format,subfolder):
    original,before,group,panels=fixture(client,tmp_path,format);destination=tmp_path/'输出';destination.mkdir();request=str(uuid4())
    response=export(client,group,destination,subfolder,request);assert response.status_code==200,response.text
    result=response.json();folder=Path(result['directory']);assert folder.parent==destination if subfolder else folder==destination
    for item,expected in zip(result['files'],panels):
        target=folder/item['file_name'];assert target.read_bytes()==expected;assert item['sha256']==digest(expected)
        assert client.get(item['url']).content==expected;assert target.resolve() in export_registry.registered_files()
    assert export(client,group,destination,subfolder,request).json()==result
    assert len(list(destination.rglob('*.'+format)))==3
    assert export(client,group,destination,not subfolder,request).status_code==409
    assert digest(original.read_bytes())==before


def test_default_exports_and_existing_subfolders_are_kept_with_one_new_group_suffix(client,tmp_path):
    original,before,group,panels=fixture(client,tmp_path)
    occupied=EXPORTS/'山海之间_split';occupied.mkdir(parents=True);sentinel=occupied/'原片.png';sentinel.write_bytes(original.read_bytes())
    result=export(client,group).json();assert Path(result['directory'])==EXPORTS/'山海之间_split_1'
    assert digest(sentinel.read_bytes())==before;assert digest(original.read_bytes())==before
    assert len(list(occupied.iterdir()))==1


def test_late_file_collision_preserves_the_existing_photo_and_renumbers_the_entire_set(client,tmp_path,monkeypatch):
    original,before,group,panels=fixture(client,tmp_path);destination=tmp_path/'output';destination.mkdir();late=destination/'山海之间_split_02.png';real_open=Path.open;triggered=False
    def open_file(path,mode='r',*args,**kwargs):
        nonlocal triggered
        if path==late and mode=='xb' and not triggered:
            triggered=True
            with real_open(path,'wb') as stream:stream.write(original.read_bytes())
        return real_open(path,mode,*args,**kwargs)
    monkeypatch.setattr(Path,'open',open_file)
    result=export(client,group,destination,False);assert result.status_code==200,result.text
    assert [p['file_name'] for p in result.json()['files']]==[f'山海之间_split_1_{i:02d}.png' for i in range(1,4)]
    assert digest(late.read_bytes())==before;assert not (destination/'山海之间_split_01.png').exists();assert digest(original.read_bytes())==before


@pytest.mark.parametrize('phase',['copy','registry','receipt'])
def test_export_failure_removes_only_new_outputs_and_a_retry_finishes(client,tmp_path,monkeypatch,phase):
    original,before,group,panels=fixture(client,tmp_path);destination=tmp_path/'output';destination.mkdir();sentinel=destination/'keep.png';sentinel.write_bytes(original.read_bytes());request=str(uuid4())
    before_records={p:p.read_bytes() for p in (DATA/'export-records').rglob('*.json')};real_copy=output._copy;real_register=export_registry.register;real_dump=json.dump;calls=0
    def copy(source,stream,expected):
        nonlocal calls
        calls+=1
        if calls==2:stream.write(source.read_bytes()[:24]);raise OSError('Synthetic full disk')
        return real_copy(source,stream,expected)
    def register(path):
        nonlocal calls
        calls+=1
        if calls==2:raise OSError('Synthetic registry failure')
        return real_register(path)
    def dump(value,*args,**kwargs):
        if isinstance(value,dict) and 'request' in value:raise OSError('Synthetic receipt failure')
        return real_dump(value,*args,**kwargs)
    with monkeypatch.context() as m:
        if phase=='copy':m.setattr(output,'_copy',copy)
        elif phase=='registry':m.setattr(export_registry,'register',register)
        else:m.setattr(json,'dump',dump)
        with pytest.raises(OSError):export(client,group,destination,True,request)
    assert list(destination.iterdir())==[sentinel]
    assert {p:p.read_bytes() for p in (DATA/'export-records').rglob('*.json')}==before_records
    assert export(client,group,destination,True,request).status_code==200
    assert digest(sentinel.read_bytes())==before and digest(original.read_bytes())==before


def test_damaged_exports_are_not_overwritten_on_retry_and_a_new_request_keeps_them(client,tmp_path):
    original,before,group,panels=fixture(client,tmp_path);destination=tmp_path/'output';destination.mkdir();request=str(uuid4())
    result=export(client,group,destination,False,request).json();changed=destination/result['files'][0]['file_name'];changed.write_bytes(original.read_bytes())
    assert export(client,group,destination,False,request).status_code==409
    assert digest(changed.read_bytes())==before
    fresh=export(client,group,destination,False);assert fresh.status_code==200
    assert all('_split_1_' in p['file_name'] for p in fresh.json()['files']);assert digest(changed.read_bytes())==before


def test_changed_saved_asset_fails_before_output_and_a_late_change_rolls_back(client,tmp_path,monkeypatch):
    original,before,group,panels=fixture(client,tmp_path);destination=tmp_path/'output';destination.mkdir()
    from backend.app.models import Session,AssetVariant
    with Session() as session:path=Path(session.get(AssetVariant,group['panels'][1]['id']).file_path)
    good=path.read_bytes();path.write_bytes(b'changed');assert export(client,group,destination).status_code==409;assert list(destination.iterdir())==[];path.write_bytes(good)
    real=output._copy;calls=0
    def copy(source,stream,expected):
        nonlocal calls
        calls+=1
        if calls==2:path.write_bytes(b'late change')
        return real(source,stream,expected)
    monkeypatch.setattr(output,'_copy',copy)
    assert export(client,group,destination).status_code==409;assert list(destination.iterdir())==[];path.write_bytes(good);assert digest(original.read_bytes())==before


def test_export_validates_directories_flags_and_group_identity(client,tmp_path):
    original,before,group,_=fixture(client,tmp_path)
    for directory in ['relative',str(tmp_path/'missing'),str(original)]:assert export(client,group,directory).status_code==422
    for value in ['true',1,None]:assert export(client,group,tmp_path,value).status_code==422
    assert client.post('/api/editor/splits/missing/export',json={'request_id':str(uuid4())}).status_code==404
    assert digest(original.read_bytes())==before


def test_native_export_rollback_preserves_an_external_edit_to_an_earlier_panel(client,tmp_path,monkeypatch):
    original,before,group,_=fixture(client,tmp_path);destination=tmp_path/'output';destination.mkdir();changed=destination/'山海之间_split_01.png';real=output._copy;calls=0
    def copy(source,stream,expected):
        nonlocal calls
        calls+=1;real(source,stream,expected)
        if calls==2:changed.write_bytes(original.read_bytes())
    monkeypatch.setattr(output,'_copy',copy)
    response=export(client,group,destination,False);assert response.status_code==409,response.text
    assert list(destination.iterdir())==[changed];assert digest(changed.read_bytes())==before;assert digest(original.read_bytes())==before
