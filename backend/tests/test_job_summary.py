from backend.app.models import Session, JobRecord, now
from backend.app.services import jobs


def test_summary_lists_concurrent_job_kinds_without_result_payloads(client):
    records = []
    for kind in ('import', 'export', 'watercolor-batch'):
        payload = dict(id='summary-'+kind, kind=kind, status='completed', total=3, processed=3,
                       success=3, skipped=0, failed=0, current='', errors=['synthetic error'],
                       results=[{'file_name': 'synthetic.png', 'url': '/api/exports/synthetic.png'}],
                       selected_snapshot=['synthetic-id'], private_field='not-a-summary-field')
        records.append(payload)
        with Session() as session:
            session.add(JobRecord(id=payload['id'], payload=payload, updated_at=now()))
            session.commit()
    summaries = client.get('/api/jobs?summary=true').json()
    assert {item['kind'] for item in summaries} == {'import', 'export', 'watercolor-batch'}
    for item in summaries:
        assert item['error_count'] == item['result_count'] == 1
        assert item['updated_at']
        assert not {'results', 'errors', 'selected_snapshot', 'private_field'} & item.keys()
    full = client.get('/api/jobs').json()
    assert all(item['results'] and item['private_field'] for item in full)
    assert client.get('/api/jobs/summary-export').json()['results'] == records[1]['results']


def test_summary_retains_parent_resource_and_cancellation_metadata(client):
    payload = dict(id='summary-child', kind='export', status='running', total=1, processed=0,
                   success=0, skipped=0, failed=0, current='', errors=[], results=[],
                   parent_id='summary-parent', resource='render', phase='processing', cancelled=True)
    with Session() as session:
        session.add(JobRecord(id=payload['id'], payload=payload, updated_at=now()))
        session.commit()
    summary = jobs.recent(summary=True)[0]
    assert summary['parent_id'] == 'summary-parent'
    assert summary['resource'] == 'render' and summary['phase'] == 'processing'
    assert summary['cancelled'] is True
