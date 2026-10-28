"""Versioned edit parameters and immutable, app-owned source/output snapshots."""
import hashlib
import os
import re
from pathlib import Path
from threading import RLock
from typing import BinaryIO
from PIL import Image
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, update
from ..config import DATA, EXPORTS
from ..models import Session, Photo, EditDocument, AssetVariant, WatermarkDraft, uid, now
from ..editor_schemas import EditCreate, EditUpdate, VariantCreate, recipe_adapter
from ..source_decode import SourceDecodeProfile, LEGACY_SOURCE_DECODE
from ..schemas import WatermarkOptions
from .import_service import file_hash
from . import export_registry

lock = RLock()
MAX_SOURCE = 256*1024*1024
MAX_RENDER = 512*1024*1024
SOURCE_FIELDS = ('camera_make','camera_model','lens_model','date_taken','f_number',
                 'exposure_time','exposure_seconds','iso','focal_length','focal_length_35mm')


def clean_name(value: str, limit: int = 180) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value).strip('. ') or 'photo'
    if len(name)>limit:
        suffix=Path(name).suffix[:12]
        name=name[:limit-len(suffix)]+suffix
    if Path(name).stem.upper() in {'CON','PRN','AUX','NUL',*[f'{p}{i}' for p in ('COM','LPT') for i in range(1,10)]}:
        name = 'photo_'+name
    return name


def new_folder(area: str, token: str) -> Path:
    root = (DATA/area).resolve()
    root.mkdir(parents=True, exist_ok=True)
    folder = root/token
    if folder.parent != root:
        raise ValueError('Invalid managed asset path.')
    folder.mkdir(exist_ok=False)
    return folder


def checked_path(value: str, namespace: tuple[str,...], token: str, source: bool) -> Path:
    path = Path(value).resolve()
    # Registered snapshots can still live in a retained source library after a DB merge.
    # Their immutable storage token is separate from a remapped database record ID.
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',token) or tuple(path.parts[-len(namespace)-2:-2]) != namespace or path.parent.name != token:
        raise HTTPException(409, '编辑文件路径无效，请从备份恢复')
    valid = re.fullmatch(r'source\.[a-z0-9]{1,8}',path.name) if source else path.name in ('image.jpg','image.png','image.webp')
    if not valid:
        raise HTTPException(409, '编辑文件路径无效，请从备份恢复')
    return path


def source_path(document: EditDocument, verify: bool = True) -> Path:
    from .split_edit_service import checked_lineage
    checked_lineage(document)
    checked_recipe(document.recipe)
    path = checked_path(document.source_path,('documents','edits'),document.source_json.get('storage_id',document.id),True)
    if not path.is_file():
        raise HTTPException(404, '编辑源文件快照不可用，请从备份恢复')
    if verify and file_hash(path) != document.source_hash:
        raise HTTPException(409, '编辑源文件快照已改变，请从备份恢复')
    return path


def variant_path(variant: AssetVariant, verify: bool = True) -> Path:
    checked_recipe(variant.recipe)
    if variant.kind.startswith('split') or 'split' in variant.source_json:
        from .split_service import lineage
        lineage(variant)
    path = checked_path(variant.file_path,('assets','variants'),variant.source_json.get('storage_id',variant.id),False)
    if not path.is_file():
        raise HTTPException(404, '编辑副本不可用，请从备份恢复')
    if verify and file_hash(path) != variant.file_hash:
        raise HTTPException(409, '编辑副本已改变，请从备份恢复')
    return path


def get_document(session, edit_id: str) -> EditDocument:
    document = session.get(EditDocument,edit_id)
    if not document: raise HTTPException(404, '编辑记录不存在')
    from .split_edit_service import checked_lineage
    checked_lineage(document)
    return document


def get_variant(session, asset_id: str) -> AssetVariant:
    variant = session.get(AssetVariant,asset_id)
    if not variant: raise HTTPException(404, '编辑副本不存在')
    return variant


def document_json(document: EditDocument) -> dict:
    checked_recipe(document.recipe)
    profile = decode_profile(document.source_json)
    from .split_edit_service import checked_lineage
    lineage = checked_lineage(document)
    return {key:getattr(document,key) for key in ('id','photo_id','source_name','source_hash','recipe','revision','created_at','updated_at')} | {
        'source_url':f'/api/editor/edits/{document.id}/source','pipeline_version':f'pc-edit-v{profile["version"]}', 'decode_profile':profile}|({'derived_from':lineage} if lineage else {})


def decode_profile(source: dict) -> dict:
    try:
        if not isinstance(source, dict):
            raise ValueError('Invalid source record.')
        return SourceDecodeProfile.model_validate(source.get('decode_profile', LEGACY_SOURCE_DECODE)).model_dump()
    except ValueError as error:
        raise HTTPException(409, '编辑源解码版本不受支持，请使用兼容的程序') from error


def checked_recipe(recipe):
    try:recipe_adapter.validate_python(recipe)
    except ValueError as error:raise HTTPException(409,'编辑配方版本不受支持，请使用兼容的程序') from error


def verify_render_recipe(recipe,expected):
    if recipe.get('version',0)>=3 or expected is not None:
        if expected is None or expected.model_dump(exclude_none=True)!=recipe:
            raise HTTPException(409,'Rendered text does not match the saved edit. Reopen the editor.')


def variant_json(variant: AssetVariant) -> dict:
    profile = decode_profile(variant.source_json)
    from .split_service import lineage
    split=lineage(variant)
    descriptor=split.model_dump(exclude_none=False) if split else None
    if descriptor:descriptor['parent_recipe']=split.parent_recipe.model_dump(exclude_none=True)
    return {key:getattr(variant,key) for key in ('id','document_id','document_revision','kind','name','file_hash','width','height','created_at')} | {
        'preview_url':f'/api/editor/variants/{variant.id}/image','pipeline_version':f'pc-edit-v{profile["version"]}', 'decode_profile':profile}|({'split':descriptor} if split else {})


def copy_upload(upload: UploadFile, stream, limit: int) -> str:
    if upload.size is not None and upload.size>limit:
        raise HTTPException(413, '图片文件超过大小限制')
    digest = hashlib.sha256();size=0
    upload.file.seek(0)
    for chunk in iter(lambda:upload.file.read(1024*1024),b''):
        size+=len(chunk)
        if size>limit: raise HTTPException(413, '图片文件超过大小限制')
        digest.update(chunk);stream.write(chunk)
    if not size: raise HTTPException(422, '图片文件为空')
    stream.flush();os.fsync(stream.fileno())
    return digest.hexdigest()


def upload_to(upload: UploadFile, target: Path, limit: int) -> str:
    with target.open('xb') as stream:
        return copy_upload(upload,stream,limit)


def cleanup_new(folder: Path) -> None:
    # Only known files in the newly created, server-generated directory are removed.
    for name in ('candidate.bin','image.jpg','image.png','image.webp'):
        (folder/name).unlink(missing_ok=True)
    for path in folder.glob('source.*'):
        path.unlink()
    folder.rmdir()


def create_document(payload: EditCreate, file: UploadFile) -> dict:
    edit_id=uid();folder=new_folder('documents/edits',edit_id)
    committed=False
    extension=Path(payload.source_name).suffix[1:].lower()
    extension=extension if re.fullmatch(r'[a-z0-9]{1,8}',extension) else 'bin'
    target=folder/('source.'+extension)
    try:
        digest=upload_to(file,target,MAX_SOURCE)
        if digest!=payload.source_hash: raise HTTPException(409, '源文件哈希不一致，请重新打开照片')
        with lock, Session() as session:
            from .lut_service import validate_recipe_asset
            validate_recipe_asset(session,payload.recipe)
            from .vision_assets import validate_recipe_assets
            validate_recipe_assets(session,payload.recipe,payload.source_hash)
            photo=session.get(Photo,payload.photo_id) if payload.photo_id else None
            if payload.photo_id and not photo: raise HTTPException(404, '照片不存在')
            if photo and (photo.file_hash!=digest or (Path(photo.file_path).is_file() and file_hash(Path(photo.file_path))!=digest)):
                raise HTTPException(409, '源文件已改变，请重新打开照片后保存')
            metadata={key:getattr(photo,key) for key in SOURCE_FIELDS} if photo else {}
            document=EditDocument(id=edit_id,photo_id=payload.photo_id,source_name=clean_name(payload.source_name,255),
                source_path=str(target),source_hash=digest,source_json=metadata|{'storage_id':edit_id,'decode_profile':payload.decode_profile.model_dump()},
                recipe=payload.recipe.model_dump(exclude_none=True),revision=1)
            session.add(document);session.commit();committed=True;return document_json(document)
    except Exception:
        if not committed: cleanup_new(folder)
        raise


def update_document(edit_id: str, payload: EditUpdate) -> dict:
    with lock, Session() as session:
        from .lut_service import validate_recipe_asset
        validate_recipe_asset(session,payload.recipe)
        from .vision_assets import validate_recipe_assets
        validate_recipe_assets(session,payload.recipe,payload.source_hash)
        document=get_document(session,edit_id)
        decode_profile(document.source_json)
        checked_recipe(document.recipe)
        if document.source_hash!=payload.source_hash: raise HTTPException(409, '源文件哈希不一致，请重新打开照片')
        source_path(document)
        if document.recipe.get('version',0)>=3 and payload.recipe.version<document.recipe['version']:raise HTTPException(409,'文字工程不能降级为旧配方，请使用兼容的编辑器')
        result=session.execute(update(EditDocument).where(EditDocument.id==edit_id,EditDocument.revision==payload.revision)
            .values(recipe=payload.recipe.model_dump(exclude_none=True),revision=payload.revision+1,updated_at=now()))
        if result.rowcount!=1:
            session.rollback();raise HTTPException(409, '编辑记录已在其他窗口改变，请重新打开')
        session.commit();session.expire_all();return document_json(get_document(session,edit_id))


def rendered_image(path: Path | BinaryIO) -> tuple[str,int,int]:
    try:
        with Image.open(path) as image:
            if image.format not in ('JPEG','PNG','WEBP') or image.width*image.height>100_000_000 or max(image.size)>16000:
                raise ValueError('Only JPEG/PNG/WebP renders up to 100 megapixels are supported.')
            extension={'JPEG':'jpg','PNG':'png','WEBP':'webp'}[image.format];width,height=image.size;image.verify()
            return extension,width,height
    except (OSError,ValueError,Image.DecompressionBombError,SyntaxError) as error:
        raise HTTPException(422, '编辑输出不是有效的JPEG/PNG/WebP图片') from error


def create_variant(payload: VariantCreate, file: UploadFile) -> dict:
    asset_id=uid();folder=new_folder('assets/variants',asset_id)
    committed=False
    try:
        candidate=folder/'candidate.bin';digest=upload_to(file,candidate,MAX_RENDER)
        extension,width,height=rendered_image(candidate);target=folder/('image.'+extension);candidate.rename(target)
        with lock, Session() as session:
            document=get_document(session,payload.document_id);source_path(document)
            checked_recipe(document.recipe)
            verify_render_recipe(document.recipe,payload.expected_recipe)
            if document.revision!=payload.document_revision: raise HTTPException(409, '编辑记录已在其他窗口改变，请重新打开')
            variant=AssetVariant(id=asset_id,document_id=document.id,document_revision=document.revision,
                name=Path(clean_name(payload.name)).stem+'.'+extension,file_path=str(target),file_hash=digest,
                width=width,height=height,recipe=document.recipe.copy(),
                source_json={key:document.source_json.get(key) for key in SOURCE_FIELDS}|{'storage_id':asset_id,'decode_profile':decode_profile(document.source_json)})
            session.add(variant);session.commit();committed=True;return variant_json(variant)
    except Exception:
        if not committed: cleanup_new(folder)
        raise


def export_render(file: UploadFile, name: str) -> dict:
    from tempfile import TemporaryDirectory
    from .safe_image_export import publish_file
    # Retain the renderer's bytes (especially JPEG), rather than encoding twice.
    EXPORTS.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(prefix='.pc-render-',dir=EXPORTS) as folder:
        temp=Path(folder)/'render.tmp'
        with temp.open('xb') as stream:copy_upload(file,stream,MAX_RENDER)
        extension,width,height=rendered_image(temp)
        with Image.open(temp) as image:
            if image.getexif() or any(k in image.info for k in ('exif','xmp','XML:com.adobe.xmp','comment')) or getattr(image,'text',{}):
                raise HTTPException(422,'Rendered exports must omit EXIF, XMP and text metadata.')
        return publish_file(temp,EXPORTS,Path(clean_name(name)).stem,extension,width,height,metadata_policy='pixels-with-color-profile')


def variant_watermark(asset_id: str) -> dict:
    from . import watermark_draft_service as drafts
    with lock, drafts.lock, Session() as session:
        variant=get_variant(session,asset_id);path=variant_path(variant);options=WatermarkOptions().model_dump()
        metadata={key:variant.source_json.get(key) for key in SOURCE_FIELDS}
        draft=WatermarkDraft(asset_variant_id=variant.id,name=Path(variant.name).stem,
            watermark_type=options['template'],template_id=options['template'],settings_json=options,
            source_json=metadata|{'file_name':variant.name,'file_path':str(path),'file_hash':variant.file_hash,
                'width':variant.width,'height':variant.height,'asset_variant_id':variant.id,'document_revision':variant.document_revision})
        session.add(draft);session.flush();return drafts.save_preview_commit(session,draft,True)
