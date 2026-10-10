"""Create disposable synthetic photos; requires an explicit isolated PHOTO_DATA_DIR."""
import json,os
from pathlib import Path
from PIL import Image,ImageDraw,TiffImagePlugin
from backend.app.config import DATA
from backend.app.models import initialize,Session,Photo
from backend.app.services.import_service import import_one
from sqlalchemy import select

def prepare() -> None:
    expected=Path(__file__).resolve().parents[1]/'.test-artifacts'
    if 'PHOTO_DATA_DIR' not in os.environ or expected.resolve() not in DATA.resolve().parents:
        raise ValueError('仅允许在项目 .test-artifacts 下建立隔离库')
    initialize();folder=DATA.parent/'synthetic-originals';folder.mkdir(exist_ok=True)
    for i in range(720):
        target=folder/f'PHOTO_{i:04}.jpg'
        if not target.exists():
            image=Image.new('RGB',(480,320),(30+i%180,50+(i*3)%130,80+(i*5)%150))
            draw=ImageDraw.Draw(image);draw.ellipse((280,40,350,110),fill=(250,195,80));draw.polygon([(0,250),(200,130),(480,290),(480,320),(0,320)],fill=(20,35,55));draw.text((20,20),f'LOCAL TEST {i}',fill='white')
            exif=Image.Exif()
            for key,value in {271:'SONY',272:'ILCE-7M4',42036:['35mm Prime','85mm Prime','24-70 Zoom'][i%3],36867:f'2026:{i%12+1:02}:{i%28+1:02} 18:24:00',33437:TiffImagePlugin.IFDRational(28,10),33434:TiffImagePlugin.IFDRational(1,500),34855:100,37386:[35,50,85][i%3]}.items():exif[key]=value
            image.save(target,exif=exif)
        import_one(target)
    raw=folder/'PHOTO_0000.ARW'
    if not raw.exists():raw.write_bytes(b'RAW metadata-only test fixture')
    import_one(raw)
    with Session() as session:
        rows=session.scalars(select(Photo).where(Photo.is_raw.is_(False)).order_by(Photo.file_name)).all()
        rows[0].favorite=True;rows[0].rating=5;rows[0].color_label='green';session.commit()
        (DATA.parent/'fixture.json').write_text(json.dumps({'photo_ids':[p.id for p in rows],'files':721,'captures':720}),encoding='utf-8')
    print('Prepared 720 captures / 721 synthetic files')

if __name__=='__main__':prepare()
