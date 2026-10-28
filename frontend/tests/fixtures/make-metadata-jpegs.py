"""Deterministic synthetic pixels/EXIF for cross-runtime tests; no user photos."""
from pathlib import Path
from PIL import Image, ImageCms, TiffImagePlugin

XMP='''<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" exif:ISOSpeedRatings="640" exif:ExposureTime="0.3" exif:DateTimeOriginal="2026-10-22T19:23:45+08:00" tiff:Model="XMP camera" tiff:Orientation="6" xmp:Rating="5"><dc:subject><rdf:Bag><rdf:li>private external tag</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>'''


def create(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    exif=Image.Exif();r=TiffImagePlugin.IFDRational
    for key,value in {271:'SONY',272:'Synthetic Camera',274:6}.items():exif[key]=value
    exif[34665]={42036:'Synthetic 50mm',37386:r(50),41989:75,33437:r(28,10),33434:r(4,5),34855:400,
        36867:'2024:02:29 23:59:59',36881:'+08:00'}
    exif[34853]={1:'S',2:(r(34),r(30),r(0)),3:'W',4:(r(123),r(15),r(0)),5:1,6:r(20)}
    profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    Image.new('RGB',(640,480),(30,90,130)).save(folder/'common.jpg',exif=exif,icc_profile=profile)
    Image.new('RGB',(640,480),(40,95,135)).save(folder/'blank.jpg')
    Image.new('RGB',(640,480),(50,100,140)).save(folder/'blank-2.jpg')
    data=(folder/'blank.jpg').read_bytes();payload=b'http://ns.adobe.com/xap/1.0/\0'+XMP.encode('utf-8')
    (folder/'embedded.jpg').write_bytes(data[:2]+b'\xff\xe1'+(len(payload)+2).to_bytes(2,'big')+payload+data[2:])
    marked=Image.new('RGB',(640,480))
    for color,box in [((220,20,30),(0,0,320,240)),((20,200,40),(320,0,640,240)),
        ((30,50,220),(0,240,320,480)),((220,200,20),(320,240,640,480))]:marked.paste(color,box)
    marked.save(folder/'orientation-exif.jpg',exif=exif,quality=96)
    from io import BytesIO
    stream=BytesIO();marked.save(stream,'JPEG',quality=96);data=stream.getvalue()
    (folder/'orientation-xmp.jpg').write_bytes(data[:2]+b'\xff\xe1'+(len(payload)+2).to_bytes(2,'big')+payload+data[2:])


if __name__=='__main__':
    import sys
    target=Path(sys.argv[1]).resolve();root=Path(__file__).resolve().parents[3]/'.test-artifacts'
    if not target.is_relative_to(root.resolve()):raise ValueError('Synthetic fixture target must be inside .test-artifacts')
    create(target)
