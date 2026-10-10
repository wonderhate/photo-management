"""Repeatable real HTTP workflow checks against an isolated library only."""
import hashlib,json,urllib.request,urllib.error
from pathlib import Path

BASE='http://127.0.0.1:8088'

def request(path: str, method: str = 'GET', body: dict | None = None):
    data=json.dumps(body).encode() if body is not None else None
    response=urllib.request.urlopen(urllib.request.Request(BASE+'/api'+path,data=data,method=method,headers={'Content-Type':'application/json'}),timeout=60)
    return json.load(response)

def main() -> None:
    health=request('/health');root=Path(__file__).resolve().parents[1]
    data=Path(health['data_dir']).resolve()
    if (root/'.test-artifacts').resolve() not in data.parents:raise ValueError('拒绝在真实照片库上运行可写验收')
    photos=request('/photos?page_size=3')['photos'];ids=[p['id'] for p in photos]
    originals={Path(p['file_path']):hashlib.sha256(Path(p['file_path']).read_bytes()).hexdigest() for p in photos}
    checks={}
    checks['library_capture_count']=request('/photos')['total']>=720
    checks['stats_raw_jpg_dedup']=request('/stats?count_mode=file')['summary']['total']==request('/stats')['summary']['total']+1
    for mode in ('focal-length','aperture','iso','shutter'):
        bins=request('/stats/'+mode)
        checks['stats_'+mode]=len(bins)>0
    checks['reports']=request('/reports/yearly/2026')['summary']['captures']>=720 and len(request('/reports/monthly/2026/9')['lenses'])>0
    checks['timeline']=request('/timeline/2026?page_size=3')['total']>=720 and len(request('/timeline/heatmap/2026'))>0
    request('/photos/batch-edit','POST',{'photo_ids':ids,'add_tags':['验收','验收'],'rating':4})
    request('/photos/batch-edit','POST',{'photo_ids':ids,'add_tags':['验收']})
    checks['batch_idempotent']=request('/photos?tag=%E9%AA%8C%E6%94%B6')['total']>=3
    album=request('/albums','POST',{'name':'HTTP 验收影集','photo_ids':ids})
    request('/albums/'+album['id']+'/order','PUT',{'photo_ids':ids[::-1]})
    checks['album_order']=request('/photos/ids?album_id='+album['id']+'&sort=manual')['ids']==ids[::-1]
    checks['compare']=len(request('/compare?ids='+','.join(ids))['photos'])==3
    drafts=[]
    for index,template in enumerate(('frame','ambient')):
        draft=request('/watermark/drafts','POST',{'photo_id':ids[index],'name':'HTTP '+template,'settings_json':{'template':template,'signature':'Local verification','long_edge':800}})
        restored=request('/watermark/drafts/'+draft['id'])
        assert restored['settings_json']['signature']=='Local verification'
        before=restored['preview_path']
        request('/watermark/drafts/'+draft['id'],'PUT',{'revision':restored['revision'],'name':'重命名 '+template})
        assert request('/watermark/drafts/'+draft['id'])['preview_path']==before
        request('/watermark/drafts/'+draft['id']+'/status','PATCH',{'status':'ready'})
        drafts.append(draft['id'])
    duplicate=request('/watermark/drafts/'+drafts[0]+'/duplicate','POST',{})
    checks['drafts_restore_duplicate']=duplicate['settings_json']['signature']=='Local verification'
    job=request('/watermark/drafts/batch-export','POST',{'draft_ids':drafts,'format':'png','long_edge':800})
    import time
    for _ in range(600):
        job=request('/jobs/'+job['id'])
        if job['status'] not in ('queued','running'):break
        time.sleep(.1)
    assert job['status']=='completed' and job['success']==2,job
    checks['batch_per_draft_exports']=all(Path(r['path']).is_file() and Path(r['path']).suffix=='.png' for r in job['results'])
    draft=request('/watermark/drafts/'+drafts[0]);request('/watermark/drafts/'+drafts[0],'PUT',{'revision':draft['revision'],'settings_json':draft['settings_json']|{'signature':'After export'}})
    checks['modified_since_export']=request('/watermark/drafts/'+drafts[0])['modified_since_export']
    for did in drafts+[duplicate['id']]:request('/watermark/drafts/'+did,'DELETE')
    request('/albums/'+album['id'],'DELETE')
    checks['originals_unchanged']=all(hashlib.sha256(p.read_bytes()).hexdigest()==value for p,value in originals.items())
    checks['backup']=Path(data/'exports'/request('/backup','POST')['file_name']).is_file()
    assert all(checks.values()),checks
    result={'checks':checks,'build_id':health['build_id'],'scope':'isolated real HTTP; no browser interactions'}
    (root/'verification'/'release-http.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
