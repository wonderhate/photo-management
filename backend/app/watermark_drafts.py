from pathlib import Path
import hashlib
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, func, or_, cast, String
from .models import Session, Photo, WatermarkDraft, now
from .draft_schemas import DraftCreate, DraftUpdate, DraftStatus, DraftExport, DraftBatchExport, DraftRelocate
from .services import watermark_draft_service as service, jobs

router = APIRouter(prefix='/api/watermark/drafts', tags=['watermark drafts'])

@router.post('', status_code=201)
def create(payload: DraftCreate):
    with service.lock, Session() as session:
        photo = session.get(Photo, payload.photo_id)
        if not photo:
            raise HTTPException(404, '照片不存在')
        options = payload.settings_json.model_dump()
        draft = WatermarkDraft(photo_id=photo.id, capture_group_id=photo.capture_group_id,
            name=payload.name.strip() or Path(photo.file_name).stem, watermark_type=options['template'],
            template_id=payload.template_id or options['template'], settings_json=options,
            source_json=service.source_snapshot(photo))
        session.add(draft)
        session.flush()
        return service.save_preview_commit(session, draft, True)

@router.get('')
def listing(status: str = '', watermark_type: str = '', search: str = '', sort: str = 'updated_desc',
            photo_id: str = '', page: int = Query(1, ge=1), page_size: int = Query(40, ge=1, le=100)):
    with Session() as session:
        conditions = []
        if watermark_type:
            conditions.append(WatermarkDraft.watermark_type == watermark_type)
        if photo_id:
            photo = session.get(Photo, photo_id)
            conditions.append(or_(WatermarkDraft.photo_id == photo_id,
                WatermarkDraft.capture_group_id == photo.capture_group_id) if photo else WatermarkDraft.photo_id == photo_id)
        if search.strip():
            # JSON snapshots retain searchable source metadata even after library removal.
            text = search.strip()
            conditions.append(or_(WatermarkDraft.name.contains(text, autoescape=True),
                *[WatermarkDraft.source_json[key].as_string().contains(text, autoescape=True) for key in ('file_name','camera_model','lens_model')],
                WatermarkDraft.settings_json['signature'].as_string().contains(text, autoescape=True)))
        counts = dict(session.execute(select(WatermarkDraft.status, func.count()).where(*conditions).group_by(WatermarkDraft.status)).all())
        counts['all'] = sum(counts.values())
        if status:
            if status not in ('draft','ready','exported'):
                raise HTTPException(422, '无效的作品状态')
            conditions.append(WatermarkDraft.status == status)
        orders = {'updated_desc':WatermarkDraft.updated_at.desc(), 'updated_asc':WatermarkDraft.updated_at.asc(),
            'created_desc':WatermarkDraft.created_at.desc(), 'date_taken':WatermarkDraft.source_json['date_taken'].as_string().desc(),
            'file_name':WatermarkDraft.source_json['file_name'].as_string().asc(), 'watermark_type':WatermarkDraft.watermark_type.asc()}
        if sort not in orders:
            raise HTTPException(422, '无效的排序')
        total = session.scalar(select(func.count()).select_from(WatermarkDraft).where(*conditions))
        drafts = session.scalars(select(WatermarkDraft).where(*conditions).order_by(orders[sort], WatermarkDraft.id)
            .offset((page-1)*page_size).limit(page_size)).all()
        photos = {p.id:p for p in session.scalars(select(Photo).where(Photo.id.in_([d.photo_id for d in drafts if d.photo_id])))}
        return {'drafts':[service.serialize(d, photos.get(d.photo_id)) for d in drafts], 'total':total, 'counts':counts}

@router.post('/batch-export', status_code=202)
def batch_export(payload: DraftBatchExport):
    return jobs.submit('export', service.batch_export, list(dict.fromkeys(payload.draft_ids)),
                       payload.model_dump(exclude={'draft_ids'}, exclude_none=True))

@router.get('/{draft_id}')
def detail(draft_id: str):
    with Session() as session:
        draft = service.get_draft(session, draft_id)
        return service.serialize(draft, session.get(Photo, draft.photo_id) if draft.photo_id else None)

@router.put('/{draft_id}')
def update(draft_id: str, payload: DraftUpdate):
    with service.lock, Session() as session:
        draft = service.get_draft(session, draft_id)
        if payload.revision != draft.revision:
            raise HTTPException(409, '作品已在其他窗口修改，请重新打开后继续编辑')
        options = payload.settings_json.model_dump() if payload.settings_json else draft.settings_json
        changed = options != draft.settings_json or (payload.template_id is not None and payload.template_id != draft.template_id)
        export_keys = {'format','quality','long_edge','filename_template'}
        visual_changed = {k:v for k,v in options.items() if k not in export_keys} != {k:v for k,v in draft.settings_json.items() if k not in export_keys}
        name_changed = payload.name is not None and payload.name != draft.name
        if not changed and not name_changed:
            return service.serialize(draft, session.get(Photo, draft.photo_id) if draft.photo_id else None)
        draft.name = payload.name if payload.name is not None else draft.name
        draft.template_id = payload.template_id if payload.template_id is not None else draft.template_id
        draft.watermark_type = options['template']
        draft.settings_json = options
        draft.updated_at = now()
        draft.revision += 1
        if changed:
            draft.status = 'draft'
        return service.save_preview_commit(session, draft, visual_changed)

@router.delete('/{draft_id}')
def delete(draft_id: str):
    with service.lock, Session() as session:
        draft = service.get_draft(session, draft_id)
        path = draft.preview_path
        session.delete(draft)
        session.commit()
        service.remove_preview(path)
        return {'ok':True}

@router.post('/{draft_id}/duplicate', status_code=201)
def duplicate(draft_id: str):
    with service.lock, Session() as session:
        original = service.get_draft(session, draft_id)
        draft = WatermarkDraft(photo_id=original.photo_id, capture_group_id=original.capture_group_id,
            name=(original.name[:176]+' 副本'), watermark_type=original.watermark_type,
            template_id=original.template_id, settings_json=original.settings_json.copy(), source_json=original.source_json.copy())
        session.add(draft)
        session.flush()
        # Copy the cached preview without expensive rendering, including offline originals.
        if original.preview_path and Path(original.preview_path).is_file():
            import shutil
            suffix = '-'+service.PREVIEW_LAYOUT if service.PREVIEW_LAYOUT in Path(original.preview_path).name else ''
            target = Path(original.preview_path).parent / f'{draft.id}{suffix}.webp'
            shutil.copyfile(original.preview_path, target)
            draft.preview_path = str(target)
        session.commit()
        return service.serialize(draft, session.get(Photo, draft.photo_id) if draft.photo_id else None)

@router.patch('/{draft_id}/status')
def status(draft_id: str, payload: DraftStatus):
    with service.lock, Session() as session:
        draft = service.get_draft(session, draft_id)
        draft.status = payload.status
        draft.updated_at = now()
        session.commit()
        return service.serialize(draft, session.get(Photo, draft.photo_id) if draft.photo_id else None)

@router.get('/{draft_id}/preview')
def preview_file(draft_id: str):
    with service.lock, Session() as session:
        draft = service.get_draft(session, draft_id)
        if not draft.preview_path or service.PREVIEW_LAYOUT not in Path(draft.preview_path).name:
            service.save_preview_commit(session, draft, True)
        if not draft.preview_path or not Path(draft.preview_path).is_file():
            raise HTTPException(404, '预览尚不可用')
        return FileResponse(draft.preview_path, media_type='image/webp')

@router.post('/{draft_id}/preview')
def regenerate(draft_id: str):
    with service.lock, Session() as session:
        return service.save_preview_commit(session, service.get_draft(session, draft_id), True)

@router.post('/{draft_id}/export')
def export(draft_id: str, payload: DraftExport):
    return service.export_draft(draft_id, payload.model_dump(exclude_none=True))

@router.post('/{draft_id}/relocate')
def relocate(draft_id: str, payload: DraftRelocate):
    from .services.import_service import import_one
    path = Path(payload.path).resolve()
    if not path.is_file():
        raise ValueError('文件不存在')
    with service.lock, Session() as session:
        draft = service.get_draft(session, draft_id)
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != draft.source_json.get('file_hash'):
            raise ValueError('所选文件与原始照片内容不一致，请选择同一张原图的新位置')
        import_one(path)
        photo = session.scalar(select(Photo).where(Photo.file_hash == digest))
        if not photo:
            raise ValueError('无法关联原始照片')
        session.refresh(photo)
        draft.photo_id = photo.id
        draft.capture_group_id = photo.capture_group_id
        draft.source_json = service.source_snapshot(photo)
        return service.save_preview_commit(session, draft, True)
