import json
from hashlib import sha256
from backend.app.models import Session,Photo
from test_facets import seed
from test_query_scope import scope


def test_timeline_uses_the_same_scope_and_count_mode_for_tree_and_photos(client,image_factory):
    source=image_factory('timeline-scope.jpg');before=sha256(source.read_bytes()).hexdigest();seed(source)
    with Session() as session:
        p=session.get(Photo,'a')
        session.add(Photo(id='analysis-raw',file_name='a.RAW',file_path=str(source.parent/'a.RAW'),file_stem='a',
            source_directory=str(source.parent),file_hash='f'*64,file_format='RAW',file_size=0,is_raw=True,
            capture_group_id=p.capture_group_id,camera_model=p.camera_model,date_taken=p.date_taken))
        session.commit()
    for mode in ('capture','file'):
        fixed=scope(client,{'camera_model':'SONY'},mode)
        params={'scope':json.dumps(fixed),'count_mode':'file' if mode=='capture' else 'capture'}
        tree=client.get('/api/timeline',params=params).json()
        expected=client.get('/api/photos/ids',params=params).json()['ids']
        assert tree['total']==len(expected) and tree['count_mode']==mode
        observed=[]
        for year,y in tree['years'].items():
            for month,m in y['months'].items():
                for day,count in m['days'].items():
                    result=client.get(f'/api/timeline/{year}/{month}/{day}',params=params).json()
                    assert result['total']==count and result['count_mode']==mode
                    observed.extend(p['id'] for p in result['photos'])
        unknown=client.get('/api/timeline/unknown',params=params).json()
        assert unknown['total']==tree['unknown_date']
        assert set(observed+[p['id'] for p in unknown['photos']])==set(expected)
    assert sha256(source.read_bytes()).hexdigest()==before


def test_reports_do_not_expand_existing_dates_and_dual_counts_remain_distinct(client,image_factory):
    source=image_factory('report-scope.jpg');seed(source)
    with Session() as session:
        p=session.get(Photo,'a')
        session.add(Photo(id='report-raw',file_name='a.RAW',file_path=str(source.parent/'a.RAW'),file_stem='a',
            source_directory=str(source.parent),file_hash='e'*64,file_format='RAW',file_size=0,is_raw=True,
            capture_group_id=p.capture_group_id,date_taken=p.date_taken))
        session.commit()
    params={'count_mode':'capture','date_from':'2026-01-01','date_to':'2026-01-01'}
    result=client.get('/api/reports/monthly/2026/1',params=params).json()
    captures=client.get('/api/photos/ids',params=params).json()['ids']
    files=client.get('/api/photos/ids',params=params|{'count_mode':'file'}).json()['ids']
    assert result['summary']['captures']==len(captures)
    assert result['summary']['files']==len(files)==len(captures)+1
    assert result['filters']['date_to']=='2026-01-01'
    narrowed=client.get('/api/timeline/2026/1/2',params=params).json()
    assert narrowed['total']==0


def test_chart_bins_intersect_locked_scope_and_match_browse_totals(client,image_factory):
    seed(image_factory('bin-scope.jpg'))
    fixed=scope(client,{'camera_model':'SONY','focal_length_min':'20'},'capture')
    for mode in ('grouped','exact'):
        params={'scope':json.dumps(fixed),'mode':mode}
        response=client.get('/api/stats',params=params);assert response.status_code==200,response.text
        for bins in response.json()['charts'].values():
            for bucket in bins:
                ids=client.get('/api/photos/ids',params={'scope':json.dumps(fixed),**bucket['filter']}).json()['ids']
                assert len(ids)==bucket['count'],bucket


def test_invalid_and_offset_dates_stay_in_camera_calendar(client,image_factory):
    seed(image_factory('wall-calendar.jpg'))
    with Session() as session:
        for p in session.scalars(__import__('sqlalchemy').select(Photo)):
            p.date_taken={'a':'2024-02-29T00:30:00+14:00','b':'2026-02-30','c':None}.get(p.id,'0000-01-01')
        session.commit()
    tree=client.get('/api/timeline').json()
    assert tree['years']['2024']['months']['02']['days']['29']==1
    assert tree['unknown_date']==tree['total']-1
    assert [p['id'] for p in client.get('/api/timeline/2024/2/29').json()['photos']]==['a']
    assert client.get('/api/timeline/2026/2/30').status_code==400
