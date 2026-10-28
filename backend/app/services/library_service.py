from pathlib import Path
from sqlalchemy import select, func, exists, delete
from ..models import Session, Photo, CaptureGroup, PhotoTag, Tag, Album, AlbumPhoto, Embedding, now

def query_photos(filters: dict, count_mode: str = 'capture'):
    scope=None
    if 'scope' in filters:
        from .query_scope import normalize,assert_library
        scope=normalize(filters['scope']);assert_library(scope)
    count_mode=scope['mode'] if scope else filters.get('count_mode',count_mode)
    if count_mode not in ('capture','file'):raise ValueError('Invalid photo scope.')
    q = select(Photo).where(Photo.removed_at.is_(None))
    use_text_index=False
    if scope:
        base=query_photos(scope['base'],count_mode)
        q=q.where(Photo.id.in_(base.with_only_columns(Photo.id).correlate(None)))
        use_text_index=bool(base.get_execution_options().get('pc_text_query'))
    if count_mode == 'capture':
        q = q.join(CaptureGroup, CaptureGroup.preferred_photo_id == Photo.id)
    from .location_index import filters as location_filters
    located=location_filters(filters)
    if located is not None:q=q.where(Photo.id.in_(located))
    if filters.get('analyzed_color'):
        import re
        from sqlalchemy.orm import aliased
        from ..models import VisualFingerprint
        from .visual_hash import ENGINE
        color=filters['analyzed_color']
        if not isinstance(color,str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',color):raise ValueError('Invalid analyzed color.')
        sample=aliased(Photo)
        colors=func.json_each(VisualFingerprint.record['palette']).table_valued('value')
        groups=select(sample.capture_group_id).join(VisualFingerprint,VisualFingerprint.photo_id==sample.id).join(
            CaptureGroup,CaptureGroup.preferred_photo_id==sample.id).where(
            VisualFingerprint.record['source_hash'].as_string()==sample.file_hash,
            VisualFingerprint.record['engine'].as_string()==ENGINE,
            exists(select(1).select_from(colors).where(colors.c.value==color.lower())))
        q=q.where(Photo.capture_group_id.in_(groups))
    if filters.get('query') is not None:
        import json
        from .photo_query import expression
        value = filters['query']
        if isinstance(value,str):
            if len(value.encode('utf-8'))>32768:raise ValueError('Invalid photo query.')
            try:value=json.loads(value)
            except (ValueError,RecursionError):raise ValueError('Invalid photo query.') from None
        q=q.where(expression(value))
        from .photo_query import uses_text_index
        use_text_index=use_text_index or uses_text_index(value)
    if filters.get('facets'):
        from .photo_facets import normalize as normalize_facets,query as facets_query
        from .photo_query import expression,uses_text_index
        facet_query=facets_query(normalize_facets(filters['facets']))
        if facet_query:
            q=q.where(expression(facet_query));use_text_index=use_text_index or uses_text_index(facet_query)
    for key in ('camera_make','camera_model', 'lens_model'):
        if filters.get(key):
            q = q.where(getattr(Photo, key) == filters[key])
    if filters.get('search'):
        q = q.where(Photo.file_name.contains(filters['search'], autoescape=True))
    for key,field in [('text','text'),('filename','file_name')]:
        if filters.get(key):
            from .photo_query import expression
            q=q.where(expression({'version':1,'root':{'op':'icontains','field':field,'value':filters[key]}}))
            use_text_index=True
    if filters.get('semantic'):
        from .embedding_service import service
        # Filtering/statistics require all matches, not the first UI result page.
        matches = service.search([filters['semantic']], 'any', float(filters.get('semantic_threshold', .25)), None)
        matched_groups = select(Photo.capture_group_id).where(Photo.id.in_([row['photo_id'] for row in matches]))
        q = q.where(Photo.capture_group_id.in_(matched_groups))
    if 'favorite' in filters and filters['favorite'] in (True,False,'true','false','1','0'):
        q=q.where(Photo.favorite.is_(filters['favorite'] in (True,'true','1')))
    if filters.get('rating'):
        q = q.where(Photo.rating == int(filters['rating']))
    if filters.get('color_label'):
        q = q.where(Photo.color_label == filters['color_label'])
    if filters.get('flag'):
        if filters['flag'] not in ('picked','rejected','unmarked'):raise ValueError('选片标记无效')
        q=q.where(Photo.flag==filters['flag'])
    if filters.get('date_from') or filters.get('date_to'):
        from sqlalchemy import case
        date=case((func.length(Photo.date_taken)==10,Photo.date_taken+'T00:00:00'),else_=func.substr(Photo.date_taken,1,19))
        if filters.get('date_from'):
            lower=str(filters['date_from']);lower=lower+'T00:00:00' if len(lower)==10 else lower
            q=q.where(date>=lower)
        if filters.get('date_to'):q=q.where(date<=str(filters['date_to'])[:10]+'T23:59:59')
    for field in ('focal_length', 'f_number', 'iso', 'exposure_seconds'):
        for suffix, operator in [('', 'eq'), ('_min', 'ge'), ('_max', 'le'), ('_lt', 'lt'), ('_gt', 'gt')]:
            value = filters.get(field + suffix)
            if value is not None and str(value) != '':
                q = q.where(getattr(getattr(Photo, field), '__' + operator + '__')(float(value)))
    if filters.get('orientation'):
        from .photo_query import field_column
        if filters['orientation'] not in ('landscape','portrait','square'):raise ValueError('Invalid photo query.')
        q=q.where(field_column('orientation')==filters['orientation'])
    if filters.get('album_id'):
        with Session() as session:
            album=session.get(Album,filters['album_id'])
            rule=album.query if album and album.type=='rule' else None
            is_rule=bool(album and album.type=='rule')
        if is_rule:
            from .photo_query import expression
            q=q.where(expression(rule))
            from .photo_query import uses_text_index
            use_text_index=use_text_index or uses_text_index(rule)
        else:
            member_groups = select(Photo.capture_group_id).join(AlbumPhoto, AlbumPhoto.photo_id == Photo.id).where(AlbumPhoto.album_id == filters['album_id'])
            q = q.where(Photo.capture_group_id.in_(member_groups))
    if filters.get('tag'):
        q = q.where(Photo.id.in_(select(PhotoTag.photo_id).join(Tag).where(Tag.name == filters['tag'])))
    if filters.get('person_id'):
        from ..models import DetectedFace
        groups = select(Photo.capture_group_id).join(DetectedFace,DetectedFace.photo_id==Photo.id).where(DetectedFace.person_id==filters['person_id'])
        q=q.where(Photo.capture_group_id.in_(groups))
    kind = filters.get('file_type')
    if kind:
        raw_groups = select(Photo.capture_group_id).where(Photo.is_raw.is_(True))
        jpeg_groups = select(Photo.capture_group_id).where(Photo.is_raw.is_(False))
        if kind in ('raw', 'paired', 'raw_only'):
            q = q.where(Photo.capture_group_id.in_(raw_groups))
        if kind in ('jpeg', 'paired', 'jpeg_only'):
            q = q.where(Photo.capture_group_id.in_(jpeg_groups))
        if kind == 'raw_only':
            q = q.where(Photo.capture_group_id.not_in(jpeg_groups))
        if kind == 'jpeg_only':
            q = q.where(Photo.capture_group_id.not_in(raw_groups))
    return q.execution_options(pc_text_query=use_text_index,pc_album_id=(scope['base'].get('album_id') if scope else None) or filters.get('album_id'),pc_count_mode=count_mode)

def serialize(session, photos: list[Photo], detail: bool = False) -> list[dict]:
    if not photos:
        return []
    ids = [p.id for p in photos]
    groups = {p.capture_group_id for p in photos}
    members: dict[str, list] = {}
    for p in session.scalars(select(Photo).where(Photo.capture_group_id.in_(groups))):
        members.setdefault(p.capture_group_id, []).append({
            'id': p.id, 'file_name': p.file_name, 'file_hash': p.file_hash, 'file_format': p.file_format, 'is_raw': p.is_raw,
            'file_path': p.file_path, 'preview_available': bool(p.preview_path),
        })
    tags: dict[str, list] = {};origins={}
    for photo_id, name, origin in session.execute(select(PhotoTag.photo_id, Tag.name,PhotoTag.origin).join(Tag).where(PhotoTag.photo_id.in_(ids))):
        tags.setdefault(photo_id, []).append(name)
        origins.setdefault(photo_id,{})[name]=origin
    result = []
    for photo in photos:
        record = {c.name: getattr(photo, c.name) for c in Photo.__table__.columns if detail or c.name != 'raw_exif'}
        from .annotation_service import view
        record.update(view(photo),tag_origins=origins.get(photo.id,{}))
        preview_status='ready' if photo.preview_path and photo.thumbnail_path else 'failed' if photo.preview_error else 'pending'
        record.update(tags=tags.get(photo.id, []), files=members.get(photo.capture_group_id, []),preview_status=preview_status,
                      thumbnail_url=f'/api/photos/{photo.id}/thumbnail' if photo.thumbnail_path else '', preview_url=f'/api/photos/{photo.id}/preview' if photo.preview_path else '')
        if detail:
            record['missing'] = not Path(photo.file_path).is_file()
            from ..models import WatermarkDraft
            record['watermark_draft_count'] = session.scalar(select(func.count()).select_from(WatermarkDraft).where(WatermarkDraft.capture_group_id == photo.capture_group_id))
        result.append(record)
    return result

def remove_photo(session, photo: Photo, whole_capture: bool) -> int:
    from ..config import DATA
    group_id = photo.capture_group_id
    targets = session.scalars(select(Photo).where(Photo.capture_group_id == group_id)).all() if whole_capture else [photo]
    for item in targets:
        # Release the active path uniqueness slot without moving a single byte.
        # An explicitly imported changed file may reuse that path; restoring the
        # old record then reports a conflict instead of overwriting either one.
        item.removed_at=now();item.removed_original_path=item.file_path
        item.file_path=str(DATA/'removed-records'/item.id)
    session.flush()
    remaining = session.scalars(select(Photo).where(Photo.capture_group_id == group_id)).all()
    group = session.get(CaptureGroup, group_id)
    if remaining:
        group.preferred_photo_id = sorted(remaining, key=lambda p: (p.is_raw, not p.preview_path))[0].id
    else:
        group.preferred_photo_id=None
    session.commit()
    return len(targets)

def set_tags(session, photo: Photo, names: list[str]) -> None:
    from .annotation_service import edit_tags
    edit_tags(session,photo,names=names)
