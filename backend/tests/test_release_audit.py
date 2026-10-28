import pytest
from desktop.release_audit import audit


@pytest.mark.parametrize('relative',['library-config.json','_internal/library.db','_internal/qwen-art-key.dpapi',
    '.local-notes/private.txt','.env.production','model.safetensors','_internal/model.onnx','logs/session.log','library.db-wal'])
def test_release_rejects_private_files_and_unapproved_weights(tmp_path,relative):
    path=tmp_path/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'synthetic private fixture')
    with pytest.raises(ValueError):audit(tmp_path,required=False)


def test_release_manifest_detects_content_changes_and_requires_notices(tmp_path):
    (tmp_path/'PhotoCollection.exe').write_bytes(b'synthetic executable')
    first=audit(tmp_path,required=False)
    (tmp_path/'PhotoCollection.exe').write_bytes(b'changed executable')
    assert audit(tmp_path,required=False)!=first
    with pytest.raises(ValueError,match='Missing release resources'):audit(tmp_path)


def test_installer_verification_refuses_existing_install_before_any_mutation(monkeypatch,tmp_path):
    import sys
    if sys.platform!='win32':pytest.skip('Windows registration guard')
    from desktop import verify_installer
    protected=tmp_path/'existing';protected.mkdir();sentinel=protected/'keep.txt';sentinel.write_text('synthetic registered install')
    monkeypatch.setattr(verify_installer,'registration',lambda:{'InstallLocation':str(protected),'DisplayVersion':'2.5.1'})
    monkeypatch.setattr(sys,'argv',['verify_installer.py',str(tmp_path/'synthetic-installer.exe')])
    monkeypatch.setattr(verify_installer.subprocess,'run',lambda *a,**kw:pytest.fail('Must not launch an installer over an existing installation'))
    with pytest.raises(AssertionError,match='installed copy exists'):verify_installer.main()
    assert sentinel.read_text()=='synthetic registered install'
