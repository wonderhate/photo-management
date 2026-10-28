"""Read-only RAW preview decoder. Imported by spawn without loading a library."""
import json
from pathlib import Path

MAX_BYTES=256*1024*1024
MAX_PIXELS=100_000_000


def decode(source):
    from io import BytesIO
    from PIL import Image, ImageOps
    import rawpy
    source=Path(source)
    if source.stat().st_size>MAX_BYTES:raise ValueError('limit')
    with rawpy.RawPy() as raw:
        raw.open_file(str(source))
        sizes=raw.sizes
        if any(value<=0 for value in (sizes.width,sizes.height,sizes.raw_width,sizes.raw_height)):
            raise ValueError('unsupported')
        if max(sizes.width*sizes.height,sizes.raw_width*sizes.raw_height)>MAX_PIXELS:
            raise ValueError('limit')
        if sizes.flip not in range(8):raise ValueError('unsupported')
        orientation=(1,2,4,3,5,8,6,7)[sizes.flip]
        width,height=(sizes.height,sizes.width) if orientation>=5 else (sizes.width,sizes.height)
        info={'width':width,'height':height,'source':'decoded-raw'}
        try:
            thumb=raw.extract_thumb()
            if thumb.format==rawpy.ThumbFormat.JPEG:
                with Image.open(BytesIO(thumb.data)) as embedded:
                    if embedded.width*embedded.height>MAX_PIXELS:raise ValueError('limit')
                    own=embedded.getexif().get(274)
                    image=ImageOps.exif_transpose(embedded).convert('RGB')
                info['source']='embedded-jpeg'
                # The embedded JPEG can already be rotated independently of RAW.
                if own and not (own==1 and orientation>=5 and (image.width>image.height)!=(width>height)):
                    orientation=1
            elif thumb.format==rawpy.ThumbFormat.BITMAP:
                if thumb.data.shape[0]*thumb.data.shape[1]>MAX_PIXELS:raise ValueError('limit')
                image=Image.fromarray(thumb.data).convert('RGB');info['source']='embedded-bitmap'
            else:raise ValueError('unsupported thumbnail')
            transforms={2:Image.Transpose.FLIP_LEFT_RIGHT,3:Image.Transpose.ROTATE_180,
                4:Image.Transpose.FLIP_TOP_BOTTOM,5:Image.Transpose.TRANSPOSE,
                6:Image.Transpose.ROTATE_270,7:Image.Transpose.TRANSVERSE,8:Image.Transpose.ROTATE_90}
            if orientation in transforms:
                rotated=image.transpose(transforms[orientation]);image.close();image=rotated
            return image,info
        except Exception:
            if 'image' in locals():image.close()
            # Standard preview only. Editing retains the separate 16-bit source.
            raw.unpack()
            image=Image.fromarray(raw.postprocess(use_camera_wb=True,half_size=True,output_bps=8))
            info['source']='decoded-raw'
            return image,info


def render(source: str, folder: str, quality: int):
    folder=Path(folder)
    try:
        from PIL import Image
        image,info=decode(source)
        with image:
            for name,edge,q in [('preview',2560,90),('thumbnail',560,quality)]:
                with image.copy() as copy:
                    copy.thumbnail((edge,edge),Image.Resampling.LANCZOS)
                    copy.save(folder/(name+'.jpg'),'JPEG',quality=q)
        (folder/'result.json').write_text(json.dumps(info),'utf-8')
    except Exception as error:
        # Native error strings can contain original paths; keep the result bounded.
        code='limit' if isinstance(error,ValueError) and str(error)=='limit' else 'unsupported'
        (folder/'result.json').write_text(json.dumps({'error':code}),'utf-8')
