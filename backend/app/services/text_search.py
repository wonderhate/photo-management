"""Canonical searchable metadata. Visual embedding retrieval stays independent."""
from sqlalchemy import select,func,case

ANNOTATION_QUERY_FIELDS=('text','description','user_description','ai_caption','detected_text')
INDEXED_FIELDS=set(ANNOTATION_QUERY_FIELDS)|{'file_name','camera_make','camera_model','lens_model','tag'}

def clean(value):return value.strip() or None if isinstance(value,str) else None

def contains(actual,wanted):
    return int(isinstance(actual,str) and isinstance(wanted,str) and wanted.lower() in actual.lower())

def value(photo,field):
    a=photo.get('annotation') or {};user=photo.get('user_description')
    if field=='user_description':return user
    if field=='description':return clean(user if user is not None else a.get('caption'))
    if field=='ai_caption':return clean(a.get('caption'))
    if field=='detected_text':return clean(a.get('detected_text'))
    tags=' '.join(sorted(photo.get('tags') or []))
    return ' '.join(v if isinstance(v,str) else '' for v in (photo.get('file_name'),photo.get('camera_model'),photo.get('lens_model'),tags,photo.get('camera_make'),value(photo,'description'),value(photo,'detected_text')))

def column(field):
    from ..models import Photo,PhotoTag,Tag
    if field=='description':return func.pc_text_clean(case((Photo.user_description.is_not(None),Photo.user_description),else_=func.json_extract(Photo.annotation,'$.caption')))
    if field in ('ai_caption','detected_text'):return func.pc_text_clean(func.json_extract(Photo.annotation,'$.'+('caption' if field=='ai_caption' else 'detected_text')))
    if field!='text':return getattr(Photo,field)
    ordered=select(Tag.name).join(PhotoTag).where(PhotoTag.photo_id==Photo.id).order_by(Tag.name).correlate(Photo).subquery()
    tags=select(func.group_concat(ordered.c.name,' ')).scalar_subquery()
    parts=[Photo.file_name,Photo.camera_model,Photo.lens_model,tags,Photo.camera_make,column('description'),column('detected_text')]
    result=func.coalesce(parts[0],'')
    for item in parts[1:]:result=result+' '+func.coalesce(item,'')
    return result
