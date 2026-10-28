"""Atomically publish one immutable full render and its ordered split variants."""
from copy import deepcopy
from pathlib import Path
from PIL import Image, ImageChops
from fastapi import HTTPException, UploadFile
from sqlalchemy import update
from ..models import Session, EditDocument, AssetVariant, uid
from ..split_schemas import SplitCreate, SplitLineage, split_plan, split_recipe, checked_split_metadata
from . import editor_service as editor


def lineage(row: AssetVariant) -> SplitLineage | None:
    try:return checked_split_metadata(row)
    except (ValueError,KeyError,TypeError,AttributeError,IndexError) as error:
        raise HTTPException(409,'Split record is damaged or unsupported. Restore a compatible backup.') from error


def group_json(session,master: AssetVariant) -> dict:
    meta=lineage(master)
    if meta is None or meta.index is not None:raise HTTPException(404,'Split group was not found.')
    common=meta.model_dump(exclude={'index'});panels=[]
    for index,asset_id in enumerate(meta.panel_ids):
        panel=session.get(AssetVariant,asset_id)
        if panel is None:raise HTTPException(409,'Split group is incomplete or inconsistent. Restore a compatible backup.')
        value=lineage(panel)
        if value is None or value.index!=index or value.model_dump(exclude={'index'})!=common or panel.document_id!=master.document_id or panel.document_revision!=master.document_revision or editor.decode_profile(panel.source_json)!=editor.decode_profile(master.source_json):raise HTTPException(409,'Split group is incomplete or inconsistent. Restore a compatible backup.')
        panels.append(editor.variant_json(panel))
    return dict(id=master.id,document_id=master.document_id,document_revision=master.document_revision,
        source_hash=meta.source_hash,decode_profile=editor.decode_profile(master.source_json),parent_recipe=meta.parent_recipe.model_dump(exclude_none=True),
        recipe=deepcopy(master.recipe),spec=meta.spec.model_dump(),plan=meta.plan.model_dump(),format=meta.format,quality=meta.quality,
        master=editor.variant_json(master),panels=panels)


def get_group(group_id: str) -> dict:
    with Session() as session:return group_json(session,editor.get_variant(session,group_id))


def _matches(master: AssetVariant,payload: SplitCreate,stem: str):
    meta=lineage(master)
    if meta is not None:editor.verify_render_recipe(meta.parent_recipe.model_dump(exclude_none=True),payload.expected_recipe)
    return meta is not None and meta.index is None and master.document_id==payload.document_id and master.document_revision==payload.document_revision and master.name==stem+'_split-master.png' and meta.source_hash==payload.source_hash and meta.master_hash==payload.master_hash and meta.panel_hashes==payload.panel_hashes and meta.spec==payload.spec and meta.format==payload.format and meta.quality==payload.quality


def _upload(upload: UploadFile,folder: Path,expected_hash: str,expected_format: str,width: int,height: int,remaining: int):
    candidate=folder/'candidate.bin'
    digest=editor.upload_to(upload,candidate,remaining)
    if digest!=expected_hash:raise HTTPException(409,'Split files do not match the frozen pixel plan.')
    extension,w,h=editor.rendered_image(candidate)
    if (extension,w,h)!=(expected_format,width,height):raise HTTPException(422,'Split files do not match the frozen pixel plan.')
    with Image.open(candidate) as image:
        if getattr(image,'n_frames',1)!=1:raise HTTPException(422,'Split files do not match the frozen pixel plan.')
    target=folder/('image.'+extension);candidate.rename(target)
    return target,target.stat().st_size


def create_group(payload: SplitCreate,file: UploadFile,panels: list[UploadFile]) -> dict:
    plan=split_plan(payload.spec)
    if len(panels)!=plan['count']:raise HTTPException(422,'Split files do not match the frozen pixel plan.')
    stem=Path(editor.clean_name(payload.name,160)).stem;folders=[];committed=False
    with editor.lock, Session() as session:
        existing=session.get(AssetVariant,payload.request_id)
        if existing:
            if not _matches(existing,payload,stem):raise HTTPException(409,'Split request conflicts with an existing saved group.')
            return group_json(session,existing)
        document=editor.get_document(session,payload.document_id)
        if document.source_hash!=payload.source_hash or document.revision!=payload.document_revision:raise HTTPException(409,'Split source no longer matches the saved edit. Reopen it before saving.')
        editor.verify_render_recipe(document.recipe,payload.expected_recipe)
        editor.source_path(document);profile=editor.decode_profile(document.source_json)
        try:recipe=split_recipe(document.recipe,payload.spec)
        except ValueError as error:raise HTTPException(409,str(error)) from error
        panel_ids=[uid() for _ in panels]
        common=dict(version=1,group_id=payload.request_id,panel_ids=panel_ids,source_hash=document.source_hash,
            master_hash=payload.master_hash,panel_hashes=payload.panel_hashes,spec=payload.spec.model_dump(),plan=plan,
            parent_recipe=deepcopy(document.recipe),format=payload.format,quality=payload.quality)
        try:
            # All destinations are freshly created managed UUID folders. Originals
            # and prior variants are never output destinations or rollback targets.
            try:folder=editor.new_folder('assets/variants',payload.request_id)
            except FileExistsError as error:raise HTTPException(409,'Split request conflicts with an existing saved group.') from error
            folders.append(folder)
            path,used=_upload(file,folder,payload.master_hash,'png',plan['width'],plan['height'],editor.MAX_RENDER)
            def record(asset_id,path,name,width,height,index):
                descriptor=SplitLineage.model_validate(common|{'index':index}).model_dump(exclude_none=False)
                # Recipe optional fields remain absent, independently of index=null.
                descriptor['parent_recipe']=deepcopy(document.recipe)
                value=AssetVariant(id=asset_id,document_id=document.id,document_revision=document.revision,
                    kind='split-master' if index is None else 'split',name=name,file_path=str(path),
                    file_hash=payload.master_hash if index is None else payload.panel_hashes[index],width=width,height=height,recipe=deepcopy(recipe),
                    source_json={key:document.source_json.get(key) for key in editor.SOURCE_FIELDS}|{'storage_id':asset_id,'decode_profile':profile,'split':descriptor})
                lineage(value);session.add(value);return value
            master=record(payload.request_id,path,stem+'_split-master.png',plan['width'],plan['height'],None)
            with Image.open(path) as raw_master:
                whole=raw_master.convert('RGBA')
                try:
                    for index,(upload,rect,asset_id) in enumerate(zip(panels,plan['panels'],panel_ids)):
                        folder=editor.new_folder('assets/variants',asset_id);folders.append(folder)
                        target,size=_upload(upload,folder,payload.panel_hashes[index],payload.format,rect['width'],rect['height'],editor.MAX_RENDER-used);used+=size
                        if payload.format=='png':
                            with Image.open(target) as raw_panel:
                                actual=raw_panel.convert('RGBA');expected=whole.crop((rect['x'],0,rect['x']+rect['width'],rect['height']))
                                try:
                                    with ImageChops.difference(actual,expected) as difference:
                                        if any(pair!=(0,0) for pair in difference.getextrema()):raise HTTPException(422,'Split output pixels do not match the complete render.')
                                finally:actual.close();expected.close()
                        record(asset_id,target,f'{stem}_split_{index+1:02d}.{payload.format}',rect['width'],rect['height'],index)
                finally:whole.close()
            # Also protect against an editor writer in another service process.
            result=session.execute(update(EditDocument).where(EditDocument.id==document.id,EditDocument.revision==payload.document_revision,
                EditDocument.source_hash==payload.source_hash).values(updated_at=EditDocument.updated_at))
            if result.rowcount!=1:raise HTTPException(409,'Split source no longer matches the saved edit. Reopen it before saving.')
            editor.source_path(document)
            session.commit();committed=True
            return group_json(session,master)
        finally:
            if not committed:
                session.rollback()
                for folder in reversed(folders):editor.cleanup_new(folder)
