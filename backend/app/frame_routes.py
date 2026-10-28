from typing import Literal
from fastapi import APIRouter, HTTPException
from sqlalchemy import select, text
from .models import Session, FrameLibraryAsset
from .frame_v2 import validate_user_frame, validate_logo, logo_image

router=APIRouter(prefix='/api/frame-library',tags=['local frame library'])


@router.get('')
def listing():
    with Session() as session:
        rows=session.scalars(select(FrameLibraryAsset).order_by(FrameLibraryAsset.created_at,FrameLibraryAsset.id)).all()
        return {'templates':[r.record for r in rows if r.kind=='templates'],'logos':[r.record for r in rows if r.kind=='logos']}


@router.post('/{kind}',status_code=201)
def create(kind: Literal['templates','logos'],payload: dict):
    try:
        if kind=='templates':validate_user_frame(payload)
        else:
            validate_logo(payload)
            with logo_image(payload):pass
    except (ValueError,TypeError,KeyError,UnicodeError) as error:raise HTTPException(422,'Invalid frame library asset.') from error
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        existing=session.get(FrameLibraryAsset,payload['id'])
        if existing:
            if existing.kind==kind and existing.record==payload:return payload
            raise HTTPException(409,'This frame asset already exists. Save a new copy.')
        session.add(FrameLibraryAsset(id=payload['id'],kind=kind,record=payload));session.commit()
    return payload


@router.delete('/{kind}/{asset_id}')
def remove(kind: Literal['templates','logos'],asset_id: str):
    with Session() as session:
        row=session.get(FrameLibraryAsset,asset_id)
        if row and row.kind!=kind:raise HTTPException(404,'Frame asset not found.')
        if row:session.delete(row);session.commit()
    # Drafts contain their own snapshots, so removing a library asset is safe.
    return {'removed':asset_id,'originals_untouched':True,'drafts_untouched':True}
