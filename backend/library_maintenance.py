"""Merge library records and relink moved originals without touching image bytes.

Always builds and validates a staged database. --apply takes consistent backups
before replacing the target, and must be used with the application stopped.
"""
import argparse
from contextlib import closing
import json
import sqlite3
import sys
from pathlib import Path
from uuid import uuid4
from types import SimpleNamespace

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.migrations import backup_database, migrate_database, SCHEMA_VERSION
from backend.app.services.face_space import identity as face_space_identity,LEGACY_SPACE


def records(connection: sqlite3.Connection, table: str) -> list[dict]:
    if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
        return []
    return [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]


def relocate(value: str | None, old: Path, new: Path, require_exists: bool = False) -> str | None:
    if not value:
        return value
    try:
        candidate = new / Path(value).relative_to(old)
    except ValueError:
        return value
    return str(candidate) if not require_exists or candidate.is_file() else value


def insert(connection: sqlite3.Connection, table: str, row: dict) -> None:
    columns = {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}
    row = {key: value for key, value in row.items() if key in columns}
    names = list(row)
    connection.execute(f'INSERT INTO {table} ({",".join(names)}) VALUES ({",".join("?" for _ in names)})', list(row.values()))


def validate_ai_history(connection: sqlite3.Connection) -> None:
    import re
    from datetime import datetime
    from backend.app.ai_schemas import Profile, validate_stored_result
    profiles=records(connection,'ai_profiles')
    if len(profiles)>20:raise ValueError('Too many AI profiles to merge.')
    for row in profiles:
        value=json.loads(row['record'])
        if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',row['id']) or 'api_key' in value or 'clear_key' in value:
            raise ValueError('Invalid stored AI profile.')
        p=Profile.model_validate(value)
        if p.revision<1:raise ValueError('Invalid stored AI profile.')
    for row in records(connection,'ai_results'):
        if not re.fullmatch(r'[a-zA-Z0-9-]{1,80}',row['id']):raise ValueError('Invalid AI result ID.')
        datetime.fromisoformat(row['created_at'])
        r=validate_stored_result(row['kind'],json.loads(row['record']))
        if row['photo_id'] is not None and (r.source is None or r.source.id!=row['photo_id']):
            raise ValueError('Invalid AI source relationship.')


def merge_ai_history(destination,incoming,photo_ids):
    # Immutable image paths use result IDs. Reject divergent collisions instead
    # of silently replacing an existing result or its generated files.
    for table in ('ai_profiles','ai_results'):
        existing={r['id']:r for r in records(destination,table)}
        for row in records(incoming,table):
            value=json.loads(row['record'])
            if table=='ai_results':
                if row['photo_id'] is not None:row['photo_id']=photo_ids.get(row['photo_id'],row['photo_id'])
                if value.get('source'):value['source']['id']=photo_ids.get(value['source']['id'],value['source']['id'])
                row['record']=json.dumps(value,ensure_ascii=False)
            saved=existing.get(row['id'])
            if saved:
                if json.loads(saved['record'])!=value or any(saved[k]!=row[k] for k in row if k!='record'):
                    raise ValueError('Conflicting AI history. Keep both libraries and resolve the conflict before merging.')
                continue
            insert(destination,table,row);existing[row['id']]=row
    validate_ai_history(destination)


def validate_edit_lineage(connection: sqlite3.Connection) -> None:
    validate_ai_history(connection)
    edits=records(connection,'edit_documents')
    from backend.app.editor_schemas import recipe_adapter
    from backend.app.split_schemas import checked_split_metadata
    version=connection.execute('PRAGMA user_version').fetchone()[0]
    from backend.app.services.photo_location import validate as validate_location
    from backend.app.services.raw_source_contract import validate as validate_raw,relation as validate_raw_relation
    photos={row['id']:row for row in records(connection,'photos')}
    for photo in photos.values():
        removed,original=photo.get('removed_at'),photo.get('removed_original_path')
        if bool(removed)!=bool(original) or removed and (version<26 or not Path(original).is_absolute()):raise ValueError('Invalid removed photo record.')
        if removed:
            from datetime import datetime
            try:datetime.fromisoformat(removed)
            except (ValueError,TypeError):raise ValueError('Invalid removed photo record.') from None
    raw_sources={row['id']:row for row in records(connection,'registered_raw_sources')}
    for row in raw_sources.values():
        if version<26:raise ValueError('RAW source records require a compatible library version.')
        value=validate_raw(json.loads(row['record']))
        if value['id']!=row['id'] or value['source_id'] is not None or not Path(value['path']).is_absolute():raise ValueError('Invalid RAW source record.')
    for row in records(connection,'photo_raw_relations'):
        if version<26:raise ValueError('RAW source records require a compatible library version.')
        value=validate_raw_relation(json.loads(row['record']))
        if value['photo_id']!=row['photo_id'] or row['photo_id'] not in photos or value['raw_id'] is not None and value['raw_id'] not in raw_sources:raise ValueError('Invalid RAW source record.')
    for row in records(connection,'photo_locations'):
        if version<26:raise ValueError('Photo locations require a compatible library version.')
        value=validate_location(json.loads(row['record']))
        if value['photo_id']!=row['photo_id'] or row['photo_id'] not in photos:raise ValueError('Invalid photo location.')
    from backend.app.frame_v2 import validate_user_frame,validate_logo,validate_frame
    for row in records(connection,'frame_library_assets'):
        if version<24:raise ValueError('Frame assets require a compatible library version.')
        value=json.loads(row['record'])
        if row['kind'] not in ('logos','templates') or value.get('id')!=row['id']:raise ValueError('Invalid frame library asset.')
        (validate_logo if row['kind']=='logos' else validate_user_frame)(value)
    for row in records(connection,'watermark_drafts'):
        value=json.loads(row['settings_json'])
        if value.get('frame_v2') is not None:
            if version<24:raise ValueError('Frame assets require a compatible library version.')
            validate_frame(value['frame_v2'])
    for row in records(connection,'media_assets'):
        if version<24:raise ValueError('Media assets require a compatible library version.')
        if row['kind']!='video' or not Path(row['file_path']).is_absolute():raise ValueError('Invalid video library.')
    from backend.app import collage_schemas
    from backend.app import collage_output_schemas
    for row in records(connection,'collage_outputs'):
        if version<23:raise ValueError('Collage outputs require a compatible library version.')
        collage_output_schemas.stored(row['id'],json.loads(row['record']),json.loads(row['assets']),row['file_path'])
    for row in records(connection,'collage_projects'):
        if version<22:raise ValueError('Collage projects require a compatible library version.')
        collage_schemas.stored_record(row['id'],json.loads(row['record']),json.loads(row['assets']))
    from backend.app.cube_lut import validate_lut_asset,parse_cube
    from hashlib import sha256
    from backend.app.lut_folders import validate_folders
    folders=records(connection,'lut_folders')
    if folders and version<20:raise ValueError('Unsupported LUT folders in an older library format.')
    validate_folders([json.loads(f['record']) for f in folders])
    if any(json.loads(f['record'])['id']!=f['id'] or not Path(f['path']).is_absolute() for f in folders):raise ValueError('Invalid LUT folder data.')
    luts={}
    for row in records(connection,'lut_assets'):
        if version<19:raise ValueError('Unsupported LUT data in an older library format.')
        metadata=json.loads(row['metadata_json']);validate_lut_asset(metadata);info=parse_cube(row['source'])
        if metadata['version']==2 and version<21:raise ValueError('Unsupported LUT source context in an older library format.')
        if row['id']!=metadata['id'] or sha256(row['source']).hexdigest()!=row['id'] or metadata['bytes']!=len(row['source']) or metadata['size']!=info['size'] or metadata['title']!=info['title']:raise ValueError('Invalid LUT asset.')
        luts[row['id']]=row
    from backend.app.vision_schemas import VisionAsset as VisionRecord
    from backend.app.layer_stack import layer_asset_hashes
    vision={}
    for row in records(connection,'vision_assets'):
        if version<28:raise ValueError('Unsupported local vision assets in an older library format.')
        record=VisionRecord.model_validate(json.loads(row['record']))
        if record.id!=row['id'] or record.kind!=row['kind'] or len(row['png'])!=record.bytes or sha256(row['png']).hexdigest()!=row['id']:raise ValueError('Invalid local vision asset.')
        vision[row['id']]=record
    def check_lut(recipe,source_hash=None):
        value=recipe.model_dump(exclude_none=True);stack=value.get('layer_stack',{})
        if stack.get('version')==2 and version<28:raise ValueError('Unsupported layer document format.')
        for hash in layer_asset_hashes(value):
            if hash not in vision:raise ValueError('Missing local vision asset.')
        for layer in stack.get('layers',[]):
            if layer['kind']=='sticker' and vision[layer['asset_hash']].kind!='sticker':raise ValueError('Invalid local vision asset.')
            if layer.get('depth'):
                asset=vision[layer['depth']['asset_hash']]
                if asset.kind!='depth' or not asset.source or asset.source.sha256!=layer['depth']['source_hash'] or source_hash is not None and layer['depth']['source_hash']!=source_hash:raise ValueError('Invalid depth source.')
        if recipe.version==5 and (version<19 or recipe.lut and recipe.lut['asset_hash'] not in luts):raise ValueError('Missing or unsupported LUT asset.')
    for row in edits+records(connection,'asset_variants'):
        recipe=recipe_adapter.validate_python(json.loads(row['recipe']))
        check_lut(recipe,row.get("source_hash") or json.loads(row["source_json"]).get("file_hash"))
        if recipe.version==4 and version<18:raise ValueError('Unsupported layer stack in an older library format.')
        if recipe.version==3 and version<17:raise ValueError('Unsupported text recipe in an older library format.')
    from backend.app.edit_lineage import validate_chain
    def unpack(row):
        return SimpleNamespace(**(row|{'source_json':json.loads(row['source_json']),'recipe':json.loads(row['recipe'])}))
    documents={row['id']:unpack(row) for row in edits}
    variants={row['id']:unpack(row) for row in records(connection,'asset_variants')}
    for variant in variants.values():
        metadata=checked_split_metadata(variant)
        if metadata:check_lut(metadata.parent_recipe,metadata.source_hash)
        if metadata and metadata.parent_recipe.version==4 and version<18:raise ValueError('Unsupported layer stack in an older library format.')
        if metadata and metadata.parent_recipe.version==3 and version<17:raise ValueError('Unsupported text recipe in an older library format.')
    for document in documents.values():validate_chain(document,documents.get,variants.get)


def merge_libraries(target: Path, source: Path, stage: Path, old: Path, new: Path) -> dict:
    if len({p.resolve() for p in (target, source, stage)}) != 3:
        raise ValueError('源库、目标库和暂存库必须不同')
    backup_database(target, stage)
    migrate_database(stage, backup=False)
    with closing(sqlite3.connect(stage)) as destination, closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as incoming, destination:
        destination.row_factory = incoming.row_factory = sqlite3.Row
        if incoming.execute('PRAGMA user_version').fetchone()[0]>SCHEMA_VERSION:raise ValueError('照片库版本较新，请使用支持该版本的程序')
        validate_edit_lineage(incoming);validate_edit_lineage(destination)
        existing_folders=records(destination,'lut_folders')
        for folder in records(incoming,'lut_folders'):
            if any(f['path']==folder['path'] for f in existing_folders):continue
            if len(existing_folders)>=20:raise ValueError('Too many LUT folders to merge.')
            if any(f['id']==folder['id'] for f in existing_folders):
                folder['id']=str(uuid4());meta=json.loads(folder['record']);meta['id']=folder['id'];folder['record']=json.dumps(meta)
            insert(destination,'lut_folders',folder);existing_folders.append(folder)
        for asset in records(incoming,'vision_assets'):
            saved=destination.execute('SELECT png,kind,record FROM vision_assets WHERE id=?',(asset['id'],)).fetchone()
            if saved and (saved[0]!=asset['png'] or saved[1]!=asset['kind'] or asset['kind']=='depth' and json.loads(saved[2])['source']!=json.loads(asset['record'])['source']):raise ValueError('Conflicting local vision asset.')
            if not saved:insert(destination,'vision_assets',asset)
        for lut in records(incoming,'lut_assets'):
            saved=destination.execute('SELECT source FROM lut_assets WHERE id=?',(lut['id'],)).fetchone()
            if saved and saved[0]!=lut['source']:raise ValueError('Conflicting LUT source.')
            if not saved:insert(destination,'lut_assets',lut)
        # Frame documents embed assets, so collisions may be remapped without
        # changing saved artwork snapshots. Destination preferences remain primary.
        existing_assets={row['id']:row for row in records(destination,'frame_library_assets')}
        for row in records(incoming,'frame_library_assets'):
            saved=existing_assets.get(row['id'])
            if saved and saved['kind']==row['kind'] and json.loads(saved['record'])==json.loads(row['record']):continue
            if saved:
                row['id']='frame-'+str(uuid4()) if row['kind']=='templates' else 'logo-'+str(uuid4())
                value=json.loads(row['record']);value['id']=row['id'];row['record']=json.dumps(value,ensure_ascii=False)
            insert(destination,'frame_library_assets',row);existing_assets[row['id']]=row
        videos=records(destination,'media_assets');video_ids={row['id'] for row in videos};video_hashes={row['file_hash'] for row in videos};video_paths={row['file_path'] for row in videos}
        for row in records(incoming,'media_assets'):
            if row['file_hash'] in video_hashes:continue
            row['file_path']=relocate(row['file_path'],old,new,True);row['cover_path']=relocate(row['cover_path'],old,new,True)
            if row['file_path'] in video_paths:raise ValueError('Conflicting video source. Reconnect the original before merging.')
            if row['id'] in video_ids:row['id']=str(uuid4())
            insert(destination,'media_assets',row);video_ids.add(row['id']);video_hashes.add(row['file_hash']);video_paths.add(row['file_path'])
        # Existing destination tables define the current application schema.
        target_photos = records(destination, 'photos')
        source_photos = records(incoming, 'photos')
        by_hash = {p['file_hash']: p for p in target_photos}
        preserved_analysis = {p['id'] for p in target_photos if (json.loads(p.get('face_data') or '{}') or {}).get('model')}
        occupied = {p['id'] for p in target_photos}
        photo_ids = {p['id']: by_hash[p['file_hash']]['id'] if p['file_hash'] in by_hash else (str(uuid4()) if p['id'] in occupied else p['id']) for p in source_photos}
        group_ids = {}
        existing_groups = {g['id'] for g in records(destination, 'capture_groups')}
        for group in records(incoming, 'capture_groups'):
            overlaps = {by_hash[p['file_hash']]['capture_group_id'] for p in source_photos if p['capture_group_id'] == group['id'] and p['file_hash'] in by_hash}
            if len(overlaps) > 1:
                raise ValueError('拍摄组存在冲突，需要人工处理')
            group_ids[group['id']] = next(iter(overlaps)) if overlaps else (str(uuid4()) if group['id'] in existing_groups else group['id'])
            if not overlaps:
                insert(destination, 'capture_groups', group | {'id': group_ids[group['id']], 'preferred_photo_id': photo_ids.get(group['preferred_photo_id'])})
        added = 0
        for photo in source_photos:
            if photo['file_hash'] in by_hash:
                current = by_hash[photo['file_hash']]
                if photo.get('favorite'):
                    destination.execute('UPDATE photos SET favorite=1 WHERE id=?', (current['id'],))
                # A manual clear is a decision, not missing metadata. Fill an
                # untouched rating and its provenance together, including when
                # the incoming database predates provenance tracking.
                if current.get('rating_source','legacy')=='none' and current.get('rating') is None:
                    origin=photo.get('rating_source') or 'legacy'
                    if photo.get('rating') is not None or origin in ('manual','legacy'):
                        destination.execute('UPDATE photos SET rating=?,rating_source=? WHERE id=?',
                            (photo.get('rating'),origin,current['id']))
                # Preserve destination edits while filling missing metadata.
                for key, value in photo.items():
                    missing = current.get(key) is None or (key == 'face_data' and current['id'] not in preserved_analysis)
                    if key not in ('id','capture_group_id','rating','rating_source','user_description','annotation','rejected_ai_tags','removed_at','removed_original_path') and missing and value is not None:
                        destination.execute(f'UPDATE photos SET {key}=? WHERE id=?', (value, current['id']))
                continue
            insert(destination, 'photos', photo | {'id': photo_ids[photo['id']], 'capture_group_id': group_ids[photo['capture_group_id']],
                **({'file_path':str(new/'removed-records'/photo_ids[photo['id']])} if photo.get('removed_at') else {}),
                'rating_source':photo.get('rating_source') or 'legacy','flag':photo.get('flag') or 'unmarked','rejected_ai_tags':photo.get('rejected_ai_tags') or '[]'})
            added += 1
        merge_ai_history(destination,incoming,photo_ids)
        mappings = {'photo_id': photo_ids, 'capture_group_id': group_ids}
        existing_people={p['id'] for p in records(destination,'face_persons')}
        for space in records(incoming,'face_model_spaces'):
            manifest=json.loads(space['manifest'])
            if space['id']==LEGACY_SPACE:
                if manifest or space['verified']:raise ValueError('Invalid face model space.')
            elif face_space_identity(manifest)!=space['id'] or not space['verified']:raise ValueError('Invalid face model space.')
            saved=destination.execute('SELECT manifest,verified FROM face_model_spaces WHERE id=?',(space['id'],)).fetchone()
            if saved and (json.loads(saved[0])!=manifest or bool(saved[1])!=bool(space['verified'])):raise ValueError('Invalid face model space.')
            if not saved:insert(destination,'face_model_spaces',space)
        for table, unique in [('tags','name'), ('face_persons','name'), ('albums',None), ('edit_documents',None), ('asset_variants',None), ('watermark_drafts',None)]:
            current = records(destination, table)
            if not destination.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                if records(incoming, table):
                    raise ValueError(f'目标库缺少 {table}，请先用当前程序升级目标库')
                continue
            current_ids = {row['id'] for row in current}
            names = {row[unique]: row['id'] for row in current} if unique else {}
            table_ids = {}
            for row in records(incoming, table):
                if unique and row[unique] in names:
                    table_ids[row['id']] = names[row[unique]]
                    continue
                new_id = str(uuid4()) if row['id'] in current_ids else row['id']
                table_ids[row['id']] = new_id
                value = row | {'id': new_id}
                for key, mapping in mappings.items():
                    if key in value:
                        value[key] = mapping.get(value[key], value[key])
                if table == 'albums':
                    value['cover_photo_id'] = photo_ids.get(value.get('cover_photo_id'), value.get('cover_photo_id'))
                if table == 'watermark_drafts' and value.get('source_json'):
                    snapshot = json.loads(value['source_json'])
                    if snapshot.get('asset_variant_id') in mappings.get('asset_variant_id',{}):
                        snapshot['asset_variant_id'] = mappings['asset_variant_id'][snapshot['asset_variant_id']]
                    value['source_json'] = json.dumps(snapshot,ensure_ascii=False)
                insert(destination, table, value)
            if table in ('tags','albums','face_persons','edit_documents','asset_variants'):
                mappings[{'tags':'tag_id','albums':'album_id','face_persons':'person_id','edit_documents':'document_id','asset_variants':'asset_variant_id'}[table]] = table_ids
            if table=='asset_variants':
                # Group IDs are logical relationships, unlike immutable storage_id.
                # Remap only after all incoming variant IDs have been allocated.
                for row in records(incoming,table):
                    snapshot=json.loads(row['source_json'])
                    if 'split' not in snapshot:continue
                    from backend.app.split_schemas import SplitLineage
                    value=SplitLineage.model_validate(snapshot['split']).model_dump(exclude_none=False)
                    if value['group_id'] not in table_ids or any(id not in table_ids for id in value['panel_ids']):raise ValueError('Invalid split group relationship.')
                    value['group_id']=table_ids[value['group_id']];value['panel_ids']=[table_ids[id] for id in value['panel_ids']]
                    value['parent_recipe']=snapshot['split']['parent_recipe'];snapshot['split']=value
                    destination.execute('UPDATE asset_variants SET source_json=? WHERE id=?',(json.dumps(snapshot,ensure_ascii=False),table_ids[row['id']]))
        collage_ids={row['id'] for row in records(destination,'collage_projects')}
        collage_mapping={}
        library_id=destination.execute('SELECT library_id FROM library_profile WHERE singleton=1').fetchone()[0]
        for row in records(incoming,'collage_projects'):
            record=json.loads(row['record']);new_id=str(uuid4()) if row['id'] in collage_ids else row['id'];collage_ids.add(new_id)
            collage_mapping[row['id']]=new_id
            record['id']=new_id;record['origin_library_id']=library_id
            for link in record['photo_links']:link['photo_id']=photo_ids.get(link['photo_id'],link['photo_id'])
            doc=record['document']
            sources=doc['value']['sources'] if doc['kind']=='single' else [i['source'] for i in doc['value']['items']]+[s for page in doc['value']['pages'] for s in page['sources']]
            for source in sources:
                if source.get('photo_id') in photo_ids:source['photo_id']=photo_ids[source['photo_id']]
            insert(destination,'collage_projects',row|{'id':new_id,'record':json.dumps(record,ensure_ascii=False)})
        output_ids={row['id'] for row in records(destination,'collage_outputs')}
        for row in records(incoming,'collage_outputs'):
            record=json.loads(row['record']);new_id=str(uuid4()) if row['id'] in output_ids else row['id'];output_ids.add(new_id);record['id']=new_id
            snapshot=record['project'];snapshot['id']=collage_mapping.get(snapshot['id'],snapshot['id']);snapshot['origin_library_id']=library_id
            for link in snapshot['photo_links']:link['photo_id']=photo_ids.get(link['photo_id'],link['photo_id'])
            doc=snapshot['document'];sources=doc['value']['sources'] if doc['kind']=='single' else [i['source'] for i in doc['value']['items']]+[s for page in doc['value']['pages'] for s in page['sources']]
            for source in sources:
                if source.get('photo_id') in photo_ids:source['photo_id']=photo_ids[source['photo_id']]
            insert(destination,'collage_outputs',row|{'id':new_id,'record':json.dumps(record,ensure_ascii=False)})
        # A child edit can refer to a group allocated after the document itself.
        # Remap logical IDs only; its owned source snapshot keeps its storage ID.
        for row in records(incoming,'edit_documents'):
            snapshot=json.loads(row['source_json'])
            if 'derived_from' not in snapshot:continue
            from backend.app.edit_lineage import SplitEditSource
            value=SplitEditSource.model_validate(snapshot['derived_from']).model_dump()
            value['document_id']=mappings['document_id'][value['document_id']]
            for key in ('group_id','variant_id'):value[key]=mappings['asset_variant_id'][value[key]]
            snapshot['derived_from']=value
            destination.execute('UPDATE edit_documents SET source_json=? WHERE id=?',(json.dumps(snapshot,ensure_ascii=False),mappings['document_id'][row['id']]))
        validate_edit_lineage(destination)
        for row in records(incoming, 'document_view_preferences'):
            insert(destination, 'document_view_preferences', row | {
                'document_id': mappings['document_id'][row['document_id']]})
        # The destination keeps its own library identity and gallery preferences.
        prototypes=records(incoming,'face_prototypes')
        if not prototypes:
            prototypes=[dict(person_id=p['id'],model_space=LEGACY_SPACE,encoding=p['representative_encoding'],dimensions=len(p['representative_encoding'])//4 if len(p['representative_encoding'])%4==0 else 0,created_at=p['created_at']) for p in records(incoming,'face_persons') if p.get('representative_encoding') is not None]
        for row in prototypes:
            value=row|{'person_id':mappings.get('person_id',{}).get(row['person_id'],row['person_id'])}
            if not destination.execute('SELECT 1 FROM face_prototypes WHERE person_id=? AND model_space=?',(value['person_id'],value['model_space'])).fetchone():insert(destination,'face_prototypes',value)
        # RAW ids are content hashes. Source paths stay external, and an existing
        # destination's chosen path and manual association take precedence.
        for row in records(incoming,'registered_raw_sources'):
            if not destination.execute('SELECT 1 FROM registered_raw_sources WHERE id=?',(row['id'],)).fetchone():insert(destination,'registered_raw_sources',row)
        for table in ('album_photos','photo_tags','embeddings','visual_fingerprints','photo_locations','photo_raw_relations'):
            for row in records(incoming, table):
                value = {key: mappings.get(key, {}).get(item, item) for key, item in row.items()}
                if table=='photo_locations':
                    from backend.app.services.photo_location import validate as validate_location
                    record=json.loads(value['record']);validate_location(record)
                    record['photo_id']=value['photo_id'];value['record']=json.dumps(record,ensure_ascii=False)
                if table=='photo_raw_relations':
                    from backend.app.services.raw_source_contract import relation as validate_raw_relation
                    record=validate_raw_relation(json.loads(value['record']))
                    record['photo_id']=value['photo_id'];value['record']=json.dumps(record,ensure_ascii=False)
                if table=='photo_tags':
                    value['origin']=row.get('origin') or 'user'
                    rejected=destination.execute('SELECT rejected_ai_tags FROM photos WHERE id=?',(value['photo_id'],)).fetchone()
                    name=destination.execute('SELECT name FROM tags WHERE id=?',(value['tag_id'],)).fetchone()
                    if rejected and name and name[0] in json.loads(rejected[0] or '[]'):continue
                    if value['origin']=='user':destination.execute("UPDATE photo_tags SET origin='user' WHERE photo_id=? AND tag_id=?",(value['photo_id'],value['tag_id']))
                keys = ('album_id','photo_id') if table == 'album_photos' else ('photo_id','tag_id') if table == 'photo_tags' else ('photo_id',) if table in ('visual_fingerprints','photo_locations','photo_raw_relations') else ('photo_id','model')
                if not destination.execute(f'SELECT 1 FROM {table} WHERE '+ ' AND '.join(f'{key}=?' for key in keys), [value[key] for key in keys]).fetchone():
                    insert(destination, table, value)
        existing_faces = records(destination, 'detected_faces')
        face_ids={}
        occupied_faces = {row['id'] for row in existing_faces}
        face_keys = {(row['photo_id'], row['face_index']) for row in existing_faces}
        for row in records(incoming, 'detected_faces'):
            photo_id = photo_ids[row['photo_id']]
            if photo_id in preserved_analysis:
                continue
            key = (photo_id, row['face_index'])
            if key in face_keys:
                continue  # Keep the destination's identity confirmation for shared photos.
            face_ids[row['id']]=str(uuid4()) if row['id'] in occupied_faces else row['id']
            insert(destination, 'detected_faces', row | {
                'id': face_ids[row['id']],
                'photo_id': photo_id,
                'person_id': mappings.get('person_id', {}).get(row['person_id'], row['person_id']),
            })
            face_keys.add(key)
        from backend.app.services.face_graph import root
        current_links={r['source_id']:r['target_id'] for r in records(destination,'face_merges')}
        incoming_links={r['source_id']:r['target_id'] for r in records(incoming,'face_merges')}
        for source_id in incoming_links:
            final_id=root(source_id,incoming_links)  # Reject cycles before installing a staged database.
            mapped=mappings['person_id'][source_id]
            target=root(mappings['person_id'][final_id],current_links)
            if mapped not in existing_people and mapped!=target:
                current_links[mapped]=target
                insert(destination,'face_merges',{'source_id':mapped,'target_id':target})
                destination.execute('UPDATE detected_faces SET person_id=? WHERE person_id=?',(target,mapped))
                destination.execute('DELETE FROM face_prototypes WHERE person_id=?',(mapped,))
        for face_id in face_ids.values():
            owner=destination.execute('SELECT person_id FROM detected_faces WHERE id=?',(face_id,)).fetchone()[0]
            resolved=root(owner,current_links)
            if resolved!=owner:destination.execute('UPDATE detected_faces SET person_id=? WHERE id=?',(resolved,face_id))
        for row in records(incoming,'face_covers'):
            person_id=mappings['person_id'][row['person_id']];face_id=face_ids.get(row['face_id'])
            if face_id and not destination.execute('SELECT 1 FROM face_covers WHERE person_id=?',(person_id,)).fetchone() and destination.execute('SELECT 1 FROM detected_faces WHERE id=? AND person_id=?',(face_id,person_id)).fetchone():
                insert(destination,'face_covers',{'person_id':person_id,'face_id':face_id})
        # Incoming undo snapshots contain foreign IDs and library identity. Keep the
        # source database as its history; never replay those events in this library.
        from backend.app.services.face_ignore import member as ignored_member,observation_key
        ignored={r['person_id'] for r in records(destination,'face_ignores')}
        for row in records(incoming,'face_ignores'):
            owner=root(mappings['person_id'][row['person_id']],current_links)
            if owner not in existing_people and owner not in ignored:
                insert(destination,'face_ignores',row|{'person_id':owner});ignored.add(owner)
        for row in records(incoming,'face_ignored_members'):
            owner=root(mappings['person_id'][row['person_id']],current_links)
            if observation_key(row['source_hash'],row['model_space'],row['encoding'],json.loads(row['location']))!=row['observation_key']:raise ValueError('忽略人脸记录损坏')
            if owner in ignored and not destination.execute('SELECT 1 FROM face_ignored_members WHERE person_id=? AND observation_key=?',(owner,row['observation_key'])).fetchone():
                insert(destination,'face_ignored_members',row|{'person_id':owner})
        # An already ignored destination person remains ignored for imported members.
        # Retain source/model-bound decisions even if those observation rows later disappear.
        if ignored:
            for row in destination.execute('SELECT f.*,p.file_hash,i.created_at AS ignored_at FROM detected_faces f JOIN photos p ON p.id=f.photo_id JOIN face_ignores i ON i.person_id=f.person_id').fetchall():
                value=ignored_member(row['person_id'],row['file_hash'],row['model_space'],row['encoding'],json.loads(row['location']),row['confirmed'],row['ignored_at'])
                if not destination.execute('SELECT 1 FROM face_ignored_members WHERE person_id=? AND observation_key=?',(value['person_id'],value['observation_key'])).fetchone():
                    value['location']=json.dumps(value['location']);insert(destination,'face_ignored_members',value)
        for photo in records(destination, 'photos'):
            original = relocate(photo['file_path'], old/'imports', new/'imports',True)
            if photo.get('removed_at'):original=relocate(original,old/'removed-records',new/'removed-records')
            if photo.get('removed_at'):
                destination.execute('UPDATE photos SET removed_original_path=? WHERE id=?',(relocate(photo['removed_original_path'],old/'imports',new/'imports',True),photo['id']))
            destination.execute('UPDATE photos SET file_path=?, source_directory=?, thumbnail_path=?, preview_path=? WHERE id=?',
                (original, str(Path(original).parent).casefold(), relocate(photo.get('thumbnail_path'), old, new, True), relocate(photo.get('preview_path'), old, new, True), photo['id']))
        for table, key in [('embeddings','embedding_path'), ('watermark_drafts','preview_path'),('edit_documents','source_path'),('asset_variants','file_path'),('collage_outputs','file_path')]:
            for row in records(destination, table):
                where = 'photo_id=? AND model=?' if table == 'embeddings' else 'id=?'
                values = [row['photo_id'], row['model']] if table == 'embeddings' else [row['id']]
                destination.execute(f'UPDATE {table} SET {key}=? WHERE {where}', [relocate(row.get(key), old, new, True)] + values)
        for table in ('collage_projects','collage_outputs'):
            for row in records(destination,table):
                assets=json.loads(row['assets'])
                for asset in assets.values():asset['path']=relocate(asset['path'],old,new,True)
                destination.execute(f'UPDATE {table} SET assets=? WHERE id=?',(json.dumps(assets),row['id']))
        for draft in records(destination, 'watermark_drafts'):
            snapshot = json.loads(draft['source_json'])
            for namespace in ('imports','assets','artworks'):
                snapshot['file_path'] = relocate(snapshot.get('file_path'),old/namespace,new/namespace,True)
            destination.execute('UPDATE watermark_drafts SET source_json=? WHERE id=?', (json.dumps(snapshot, ensure_ascii=False), draft['id']))
        violations = destination.execute('PRAGMA foreign_key_check').fetchall()
        integrity = destination.execute('PRAGMA integrity_check').fetchone()[0]
        if violations or integrity != 'ok':
            raise ValueError(f'合并校验失败：{integrity}，外键冲突 {len(violations)}')
        photos = records(destination, 'photos')
        return {'added': added, 'files': len(photos), 'captures': len(records(destination,'capture_groups')), 'drafts': len(records(destination,'watermark_drafts')),
                'missing': [p['file_path'] for p in photos if not Path(p['file_path']).is_file()], 'integrity': integrity, 'stage':str(stage)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('target','source','stage','old-root','new-root'):
        parser.add_argument('--'+argument, required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    result = merge_libraries(args.target, args.source, args.stage, args.old_root, args.new_root)
    if args.apply:
        result['backups'] = [str(backup_database(path)) for path in (args.target, args.source)]
        # SQLite backup handles live WAL correctly; caller stops the server before apply.
        with closing(sqlite3.connect(args.stage)) as stage, closing(sqlite3.connect(args.target)) as target:
            stage.backup(target)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
