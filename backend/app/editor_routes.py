import json
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import select, func
from .models import Session, EditDocument, AssetVariant
from .editor_schemas import EditCreate, EditUpdate, VariantCreate
from .services import editor_service as service
from .split_schemas import SplitCreate,SplitExport
from .edit_lineage import SplitEditCreate
from .services import split_service,split_export_service,split_edit_service

router=APIRouter(prefix='/api/editor',tags=['local editor'])


def parse_payload(model, value: str):
    try:
        return model.model_validate(json.loads(value))
    except (ValueError,ValidationError) as error:
        raise HTTPException(422,'编辑参数无效，请检查源文件和参数') from error


@router.get('/edits')
def list_edits(page: int=Query(1,ge=1),page_size: int=Query(80,ge=1,le=200),search: str=''):
    with Session() as session:
        conditions=[EditDocument.source_name.contains(search,autoescape=True)] if search else []
        rows=session.scalars(select(EditDocument).where(*conditions).order_by(EditDocument.updated_at.desc(),EditDocument.id)
            .offset((page-1)*page_size).limit(page_size)).all()
        return {'edits':[service.document_json(row) for row in rows],
                'total':session.scalar(select(func.count()).select_from(EditDocument).where(*conditions))}


@router.post('/edits',status_code=201)
def create_edit(payload: str=Form(...),file: UploadFile=File(...)):
    return service.create_document(parse_payload(EditCreate,payload),file)


@router.get('/edits/{edit_id}')
def edit_detail(edit_id: str):
    with Session() as session:
        return service.document_json(service.get_document(session,edit_id))


@router.put('/edits/{edit_id}')
def update_edit(edit_id: str,payload: EditUpdate):
    return service.update_document(edit_id,payload)


@router.delete('/edits/{edit_id}')
def delete_edit(edit_id: str):
    with service.lock, Session() as session:
        document=service.get_document(session,edit_id)
        if session.scalar(select(AssetVariant.id).where(AssetVariant.document_id==edit_id).limit(1)):
            raise HTTPException(409,'编辑记录已有保存的作品副本，暂不能移除')
        session.delete(document);session.commit()
        # App-owned snapshots are retained for the explicit garbage collector.
        return {'ok':True}


@router.get('/edits/{edit_id}/source')
def edit_source(edit_id: str):
    with Session() as session:
        document=service.get_document(session,edit_id)
        return FileResponse(service.source_path(document),filename=document.source_name,media_type='application/octet-stream')


@router.get('/variants')
def list_variants(page: int=Query(1,ge=1),page_size: int=Query(80,ge=1,le=200)):
    with Session() as session:
        visible=AssetVariant.kind!='split-master'
        rows=session.scalars(select(AssetVariant).where(visible).order_by(AssetVariant.created_at.desc(),AssetVariant.id)
            .offset((page-1)*page_size).limit(page_size)).all()
        return {'variants':[service.variant_json(row) for row in rows],
                'total':session.scalar(select(func.count()).select_from(AssetVariant).where(visible))}


@router.post('/variants',status_code=201)
def create_variant(payload: str=Form(...),file: UploadFile=File(...)):
    return service.create_variant(parse_payload(VariantCreate,payload),file)


@router.post('/splits',status_code=201)
def create_split(payload: str=Form(...),file: UploadFile=File(...),panels: list[UploadFile]=File(...)):
    return split_service.create_group(parse_payload(SplitCreate,payload),file,panels)


@router.get('/splits/{group_id}')
def split_detail(group_id: str):
    return split_service.get_group(group_id)


@router.post('/splits/{group_id}/export')
def split_export(group_id: str,payload: SplitExport):
    return split_export_service.export_group(group_id,payload)


@router.post('/splits/{group_id}/panels/{panel_id}/edit',status_code=201)
def split_panel_edit(group_id: str,panel_id: str,payload: SplitEditCreate):
    return split_edit_service.create_from_panel(group_id,panel_id,payload)


@router.get('/splits')
def list_splits(document_id: str,page: int=Query(1,ge=1),page_size: int=Query(20,ge=1,le=100)):
    with Session() as session:
        service.get_document(session,document_id)
        conditions=[AssetVariant.kind=='split-master',AssetVariant.document_id==document_id]
        rows=session.scalars(select(AssetVariant).where(*conditions).order_by(AssetVariant.created_at.desc(),AssetVariant.id)
            .offset((page-1)*page_size).limit(page_size)).all()
        return {'items':[split_service.group_json(session,row) for row in rows],
                'total':session.scalar(select(func.count()).select_from(AssetVariant).where(*conditions))}


@router.get('/variants/{asset_id}')
def variant_detail(asset_id: str):
    with Session() as session:
        variant=service.get_variant(session,asset_id)
        return service.variant_json(variant)|{'recipe':variant.recipe}


@router.get('/variants/{asset_id}/image')
def variant_image(asset_id: str):
    with Session() as session:
        return FileResponse(service.variant_path(service.get_variant(session,asset_id)))


@router.post('/variants/{asset_id}/watermark',status_code=201)
def variant_watermark(asset_id: str):
    return service.variant_watermark(asset_id)


@router.post('/exports',status_code=201)
def export_render(file: UploadFile=File(...),name: str=Form(...)):
    return service.export_render(file,name)
