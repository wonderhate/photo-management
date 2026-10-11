"""Disposable synthetic desktop library for Android/Chromium remote-client checks."""
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.test-artifacts' / 'remote-client'
os.environ['PHOTO_DATA_DIR'] = str(DATA / 'library')
os.environ['PHOTO_EXPORT_DIR'] = str(DATA / 'exports')
os.environ['PHOTO_MODELS_DIR'] = str(DATA / 'models')
os.environ['PHOTO_LIBRARY_CONFIG'] = str(DATA / 'library-config.json')
os.environ['PHOTO_AUTOLOAD_AI'] = '0'

def main():
    from PIL import Image, ImageDraw, TiffImagePlugin
    from backend.app.models import initialize
    from backend.app.services import import_service
    from backend.app import remote
    from backend.app.main import app
    import uvicorn
    sources = DATA / 'synthetic-originals'
    sources.mkdir(parents=True, exist_ok=True)
    palette = [((242,175,160),(115,99,138)),((165,194,204),(44,96,108)),((211,179,121),(87,95,74)),((185,198,182),(81,105,99)),((157,182,207),(69,90,136)),((218,188,178),(143,91,103)),((161,181,183),(40,74,90)),((212,193,150),(96,101,92))]
    for i,(sky,land) in enumerate(palette):
        target = sources / f'Light-{i+1:02}.jpg'
        if target.exists(): continue
        image = Image.new('RGB',(960,720),sky);draw = ImageDraw.Draw(image)
        draw.ellipse((570,100,680,210),fill=(249,222,177))
        draw.polygon([(0,530),(270,230+i*12),(500,500),(750,280),(960,550),(960,720),(0,720)],fill=land)
        draw.polygon([(0,620),(280,440),(580,610),(790,470),(960,600),(960,720),(0,720)],fill=tuple(max(0,v-23) for v in land))
        exif=Image.Exif()
        for key,value in {271:'SONY',272:'ILCE-7M4',42036:'FE 35mm F1.8',36867:f'2026:10:{i+1:02} 17:24:00',33437:TiffImagePlugin.IFDRational(28,10),33434:TiffImagePlugin.IFDRational(1,250),34855:100,37386:TiffImagePlugin.IFDRational(35,1)}.items():exif[key]=value
        image.save(target,quality=92,exif=exif)
    initialize()
    for source in sorted(sources.glob('*.jpg')):
        import_service.import_one(source)
    remote.write_config({'enabled':True,'code':'12345678','pairing_expires':time.time()+86400,'sessions':{}})
    uvicorn.run(app,host='0.0.0.0',port=8012,proxy_headers=False)

if __name__=='__main__':main()
