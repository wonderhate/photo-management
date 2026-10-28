from backend.app.services import capability_service as service


def configure(monkeypatch, *, dependency=True, semantic_state='not_loaded', loaded=False, cached=False, face_loaded=False, credential=False, key_error=False):
    monkeypatch.setattr(service,'detected',lambda _name:dependency)
    monkeypatch.setattr(service.semantic,'state',{'status':semantic_state})
    monkeypatch.setattr(service.semantic,'model',object() if loaded else None)
    monkeypatch.setattr(service.semantic,'model_name','synthetic-clip')
    monkeypatch.setattr(service.face_service,'_engines',(object(),object()) if face_loaded else None)
    monkeypatch.setattr(service.face_service,'status',lambda:dict(dependency=dependency,cached=cached,available=dependency and cached,model='synthetic-faces'))
    monkeypatch.setattr(service.art_credentials,'status',lambda:dict(configured=credential,key_error=key_error,api_key='never-return-this-secret',key_source='environment'))


def test_capabilities_are_read_only_and_do_not_claim_cloud_or_unloaded_models_verified(client,monkeypatch):
    configure(monkeypatch,cached=True,credential=True)
    def forbidden(*args,**kwargs):raise AssertionError('Capability reads must not perform work')
    monkeypatch.setattr(service.semantic,'start',forbidden)
    monkeypatch.setattr(service.semantic,'status',forbidden) # Avoid recursive model directory scans too.
    monkeypatch.setattr(service.face_service,'download_models',forbidden)
    monkeypatch.setattr(service.face_service,'detect_faces',forbidden)
    response=client.get('/api/workspace/capabilities');assert response.status_code==200,response.text
    data=response.json();items=data['items']
    assert data['version']==1 and data['runtime']=='native'
    assert items['semantic']['state']=='degraded' and not items['semantic']['runnable']
    assert items['faces']['state']=='degraded' and items['faces']['runnable']
    assert items['watercolor']['state']=='degraded' and items['watercolor']['runnable']
    assert items['watercolor']['facts']['connection']=='not_checked'
    assert items['watercolor']['facts']['consent_required'] is True
    assert 'never-return-this-secret' not in response.text and 'key_source' not in response.text
    assert 'cache' not in items['semantic']['facts'] and 'path' not in items['semantic']['facts']


def test_capabilities_distinguish_missing_dependencies_failed_models_and_verified_loads(client,monkeypatch):
    configure(monkeypatch,dependency=False,cached=True,key_error=True)
    items=client.get('/api/workspace/capabilities').json()['items']
    assert items['semantic']['reason']==items['faces']['reason']=='dependency_missing'
    assert items['watercolor']['reason']=='credential_error' and not items['watercolor']['runnable']
    configure(monkeypatch,semantic_state='error')
    items=client.get('/api/workspace/capabilities').json()['items']
    assert items['semantic']['reason']=='model_error'
    assert items['faces']['reason']=='weights_missing'
    configure(monkeypatch,semantic_state='ready',loaded=True,cached=True,face_loaded=True)
    items=client.get('/api/workspace/capabilities').json()['items']
    assert items['semantic']['state']==items['faces']['state']=='available'
    assert items['semantic']['runnable'] and items['faces']['runnable']
    assert items['watercolor']['reason']=='credential_missing'


def test_one_status_provider_failure_preserves_other_features_and_does_not_leak_details(client,monkeypatch):
    configure(monkeypatch)
    def broken():raise OSError('private-file-path-and-secret')
    monkeypatch.setattr(service.face_service,'status',broken)
    response=client.get('/api/workspace/capabilities');assert response.status_code==200
    assert response.json()['items']['faces']['reason']=='status_unavailable'
    assert response.json()['items']['library']['state']=='available'
    assert response.json()['items']['semantic']['reason']=='model_not_loaded'
    assert 'private-file-path-and-secret' not in response.text
