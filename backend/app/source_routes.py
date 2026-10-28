from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select,text
from .models import Photo,Session,now
from .services.import_service import file_hash

router=APIRouter(prefix='/api/sources',tags=['sources'])


class Relink(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    path:str=Field(min_length=1,max_length=32768)


@router.post('/photos/{photo_id}/relink')
def relink(photo_id:str,value:Relink):
    candidate=Path(value.path)
    if not candidate.is_absolute():raise ValueError('Choose an absolute original file path.')
    try:
        path=candidate.resolve(strict=True)
        if not path.is_file():raise OSError()
        before=path.stat();digest=file_hash(path)
    except OSError:raise ValueError('The selected original is unavailable.') from None
    with Session() as session:
        session.execute(text('BEGIN IMMEDIATE'))
        photo=session.get(Photo,photo_id)
        if photo is None:raise ValueError('Photo record no longer exists.')
        if digest!=photo.file_hash:raise ValueError('The selected file does not match the original content hash.')
        occupied=session.scalar(select(Photo.id).where(Photo.file_path==str(path),Photo.id!=photo_id))
        if occupied:raise ValueError('The selected path belongs to another photo record.')
        try:
            after=path.stat()
            if (before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns) or file_hash(path)!=digest:
                raise ValueError('The source photo changed. Reopen it before saving.')
        except OSError:raise ValueError('The selected original is unavailable.') from None
        photo.file_path=str(path);photo.file_name=path.name;photo.file_stem=path.stem.casefold();photo.source_directory=str(path.parent).casefold();photo.updated_at=now()
        session.commit()
    return {'id':photo_id,'file_path':str(path),'originals_untouched':True}
