"""Create independent, neutral edits of immutable panels, retaining their lineage."""
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import object_session
from ..edit_lineage import SplitEditCreate, neutral_recipe, panel_descriptor as descriptor, validate_chain, LINEAGE_ERROR as ERROR
from ..models import EditDocument, AssetVariant, Session
from . import editor_service as editor, split_service

def checked_lineage(document: EditDocument) -> dict | None:
    session=object_session(document)
    try:
        if session is None:
            # A detached object cannot prove cross-record relationships.
            if 'derived_from' in document.source_json:raise ValueError(ERROR)
            return None
        value=validate_chain(document,lambda id:session.get(EditDocument,id),lambda id:session.get(AssetVariant,id))
        return value.model_dump() if value else None
    except (ValueError,KeyError,TypeError,AttributeError,IndexError,HTTPException) as error:
        raise HTTPException(409,ERROR) from error


def create_from_panel(group_id: str, panel_id: str, payload: SplitEditCreate) -> dict:
    folder=None;committed=False
    with editor.lock, Session() as session:
        master=editor.get_variant(session,group_id)
        split_service.group_json(session,master)
        panel=editor.get_variant(session,panel_id)
        try:value=descriptor(panel,master)
        except (ValueError,KeyError,TypeError,IndexError) as error:raise HTTPException(409,ERROR) from error
        editor.get_document(session,value.document_id)
        existing=session.get(EditDocument,payload.request_id)
        if existing:
            if checked_lineage(existing)!=value.model_dump():raise HTTPException(409,'Split edit request conflicts with an existing edit.')
            editor.source_path(existing)
            # A lost response must not reset subsequent edits to the child.
            return editor.document_json(existing)
        if payload.request_id in (value.group_id,value.variant_id,value.document_id):raise HTTPException(409,'Split edit request conflicts with an existing edit.')
        source=editor.variant_path(panel,verify=False)
        if source.stat().st_size>editor.MAX_SOURCE:raise HTTPException(413,'Photo exceeds the 256 MiB browser import limit.')
        editor.variant_path(panel)
        extension,width,height=editor.rendered_image(source)
        if (width,height)!=(value.width,value.height):raise HTTPException(409,ERROR)
        try:
            try:folder=editor.new_folder('documents/edits',payload.request_id)
            except FileExistsError as error:raise HTTPException(409,'Split edit request conflicts with an existing edit.') from error
            target=folder/('source.'+extension)
            with source.open('rb') as stream:
                digest=editor.upload_to(UploadFile(file=stream),target,editor.MAX_SOURCE)
            if digest!=value.source_hash:raise HTTPException(409,ERROR)
            # Detect a changed input during copying, before publishing a record.
            editor.variant_path(panel)
            document=EditDocument(id=payload.request_id,photo_id=None,source_name=editor.clean_name(panel.name,255),
                source_path=str(target),source_hash=digest,recipe=neutral_recipe(),revision=1,
                source_json={key:panel.source_json.get(key) for key in editor.SOURCE_FIELDS}|{
                    'storage_id':payload.request_id,'decode_profile':{'version':2,'extra_orientation':1},'derived_from':value.model_dump()})
            session.add(document);session.flush()
            checked_lineage(document)
            session.commit();committed=True
            return editor.document_json(document)
        finally:
            if not committed:
                session.rollback()
                if folder is not None:editor.cleanup_new(folder)
