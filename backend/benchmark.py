"""Synthetic DB-only performance probe. Never changes the user's library."""
import os
import json
import time
from pathlib import Path
from uuid import uuid4

folder=Path(__file__).resolve().parents[1]/'.test-artifacts'/('benchmark-'+uuid4().hex)
folder.mkdir(parents=True)
os.environ['PHOTO_DATA_DIR']=str(folder)
os.environ['PHOTO_AUTOLOAD_AI']='0'
from backend.app.models import initialize,Session,Photo,CaptureGroup,engine
from backend.app.services.stats_service import report,statistics
from backend.app.services.library_service import query_photos
from sqlalchemy import insert

def main() -> None:
    initialize()
    size=50000
    groups=[];photos=[]
    for i in range(size):
        group=f'capture-{i//2}';pid=f'photo-{i}'
        if i%2==0:groups.append(dict(id=group,preferred_photo_id=pid,date_taken=f'2026-{i%12+1:02}-{i%28+1:02}T18:00:00'))
        photos.append(dict(id=pid,file_path=str(folder/f'{pid}.jpg'),file_name=f'{pid}.jpg',file_stem=pid,
            source_directory=str(folder),file_hash=str(i),file_format='JPG' if i%2==0 else 'ARW',file_size=100,
            is_raw=bool(i%2),capture_group_id=group,date_taken=f'2026-{(i//2)%12+1:02}-{(i//2)%28+1:02}T18:00:00',
            camera_model='Synthetic camera',lens_model=f'Test lens {(i//2)%8}',focal_length=[24,35,50,85][(i//2)%4],
            f_number=2.8,exposure_seconds=.002,exposure_time='1/500',iso=100,width=6000,height=4000))
    with Session() as session:
        session.execute(insert(CaptureGroup),groups)
        session.execute(insert(Photo),photos)
        session.commit()
    result={'synthetic_files':size,'captures':len(groups),'measurements_seconds':{}}
    for name,action in [('yearly',lambda:report(2026,None,{},'capture')),
                        ('monthly',lambda:report(2026,9,{},'capture')),
                        ('stats',lambda:statistics({},'capture'))]:
        start=time.perf_counter();action();result['measurements_seconds'][name]=round(time.perf_counter()-start,3)
    with Session() as session:
        start=time.perf_counter();session.scalars(query_photos({'lens_model':'Test lens 1'}).limit(80)).all()
        result['measurements_seconds']['filtered_page']=round(time.perf_counter()-start,3)
    engine.dispose()
    output=Path(__file__).resolve().parents[1]/'verification';output.mkdir(exist_ok=True)
    (output/'performance.json').write_text(json.dumps(result,indent=2),'utf-8')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
