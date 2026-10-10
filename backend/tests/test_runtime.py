from backend.app.services import jobs,plugin_service
from backend.app.models import Session,JobRecord
from test_library import import_paths,wait_job

def test_job_restart_recovery_and_cancel(client):
    with Session() as session:
        session.add(JobRecord(id='previous',payload={'id':'previous','status':'running','kind':'import','processed':3}))
        session.commit()
    jobs.recover()
    assert client.get('/api/jobs/previous').json()['status']=='interrupted'
    assert client.get('/api/jobs').json()[0]['processed']==3
    def cancelled(job_id):
        jobs.cancel(job_id);jobs.check(job_id)
    job=jobs.submit('import',cancelled)
    import time
    for _ in range(100):
        result=client.get('/api/jobs/'+job['id']).json()
        if result['status']=='cancelled':break
        time.sleep(.01)
    assert result['status']=='cancelled'
    jobs.recover()
    assert client.get('/api/jobs/'+job['id']).json()['status']=='cancelled'

def test_plugin_discovery_is_passive_and_updates_are_atomic(client,image_factory,tmp_path,monkeypatch):
    import_paths(client,[image_factory()])
    photo=client.get('/api/photos').json()['photos'][0]
    monkeypatch.setattr(plugin_service,'PLUGINS',tmp_path)
    marker=tmp_path/'executed.txt'
    plugin=tmp_path/'example.py'
    plugin.write_text(f'"""Example"""\nfrom pathlib import Path\nPath({str(marker)!r}).write_text("executed")\ndef run(ctx):\n ctx.update({photo["id"]!r},rating=4,add_tags=["test","test"])\n',encoding='utf-8')
    assert client.get('/api/plugins').json()[0]['description']=='Example' and not marker.exists()
    assert client.post('/api/plugins/example/run',json={'params':{}}).status_code==200
    assert marker.exists() and client.get('/api/photos/'+photo['id']).json()['rating']==4
    plugin.write_text(f'def run(ctx):\n ctx.update({photo["id"]!r},rating=1)\n ctx.update({photo["id"]!r},rating=99)\n',encoding='utf-8')
    assert client.post('/api/plugins/example/run',json={'params':{}}).status_code==400
    assert client.get('/api/photos/'+photo['id']).json()['rating']==4
