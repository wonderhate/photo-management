"""Read-only relationship projection. Existing record IDs and snapshots stay authoritative."""
import re
from sqlalchemy import select
from ..models import (Session,Photo,RegisteredRawSource,PhotoRawRelation,EditDocument,
    AssetVariant,Artwork,WatermarkDraft,CollageProject,CollageOutput,LibraryProfile,AIResult)

KINDS={'photo','capture','raw','edit','variant','watercolor','watermark','collage','collage-output','split','ai-result'}


class Graph:
    def __init__(self):self.nodes={};self.links={}
    def node(self,kind,id,name,**details):
        key=f'{kind}:{id}';self.nodes[key]=dict(key=key,kind=kind,id=id,name=name,**details);return key
    def link(self,source,target,kind,revision=None):
        if source==target:return
        for key in (source,target):
            if key not in self.nodes:
                category,id=key.split(':',1);self.node(category,id,id,missing=True)
        value=dict(from_=source,to=target,kind=kind);value['from']=value.pop('from_')
        if revision is not None:value['revision']=revision
        self.links[(source,target,kind,revision)]=value
    def view(self,kind,id):
        if kind not in KINDS or not re.fullmatch('[a-zA-Z0-9-]{1,80}',id):raise ValueError('Invalid asset graph selection.')
        focus=f'{kind}:{id}'
        if focus not in self.nodes:raise ValueError('Asset record no longer exists.')
        adjacent={}
        for edge in self.links.values():
            for key in (edge['from'],edge['to']):adjacent.setdefault(key,[]).append(edge)
        selected={focus};queue=[(focus,0)];truncated=False
        for own,depth in queue:
            for edge in adjacent.get(own,[]):
                key=edge['to'] if edge['from']==own else edge['from']
                if key in selected:continue
                if len(selected)>=80 or depth>=6:truncated=True;continue
                selected.add(key);queue.append((key,depth+1))
        links=[e for e in self.links.values() if e['from'] in selected and e['to'] in selected]
        return dict(focus=focus,nodes=[self.nodes[k] for k,_ in queue],links=links[:160],truncated=truncated or len(links)>160)


def snapshot(kind,id):
    g=Graph()
    with Session() as s:
        library=s.get(LibraryProfile,1).library_id
        for r in s.scalars(select(AIResult)):
            g.node('ai-result',r.id,(r.record.get('source') or {}).get('name') or r.record.get('text') or r.id)
            if r.photo_id:g.link(f'ai-result:{r.id}',f'photo:{r.photo_id}','ai-source')
            if r.record.get('parent_id'):g.link(f'ai-result:{r.id}',f'ai-result:{r.record["parent_id"]}','ai-version')
        # Do not load original EXIF/analysis blobs just to render a relationship view.
        for p in s.execute(select(Photo.id,Photo.file_name,Photo.capture_group_id,Photo.removed_at).execution_options(include_removed=True)):
            g.node('photo',p.id,p.file_name,removed=bool(p.removed_at));g.node('capture',p.capture_group_id,p.capture_group_id)
            g.link(f'photo:{p.id}',f'capture:{p.capture_group_id}','capture-member')
        for r in s.scalars(select(RegisteredRawSource)):g.node('raw',r.id,r.record['file_name'])
        for r in s.scalars(select(PhotoRawRelation)):
            if r.record.get('raw_id'):g.link(f'photo:{r.photo_id}',f'raw:{r.record["raw_id"]}','raw-source',r.record['revision'])
        for e in s.execute(select(EditDocument.id,EditDocument.source_name,EditDocument.photo_id,EditDocument.revision,EditDocument.source_json)):
            g.node('edit',e.id,e.source_name,revision=e.revision)
            if e.photo_id:g.link(f'edit:{e.id}',f'photo:{e.photo_id}','edit-source')
            parent=e.source_json.get('derived_from')
            if parent:g.link(f'edit:{e.id}',f'variant:{parent["variant_id"]}','edit-source',parent['document_revision'])
        for v in s.execute(select(AssetVariant.id,AssetVariant.name,AssetVariant.document_id,AssetVariant.document_revision,AssetVariant.kind,AssetVariant.source_json)):
            g.node('variant',v.id,v.name);g.link(f'variant:{v.id}',f'edit:{v.document_id}','rendered-from',v.document_revision)
            split=v.source_json.get('split')
            if isinstance(split,dict) and split.get('group_id'):
                group=split['group_id'];g.node('split',group,group);g.link(f'variant:{v.id}',f'split:{group}','split-source')
        for a in s.execute(select(Artwork.id,Artwork.photo_id,Artwork.source_json,Artwork.revision)):
            g.node('watercolor',a.id,a.source_json.get('file_name',a.id),revision=a.revision)
            if a.photo_id:g.link(f'watercolor:{a.id}',f'photo:{a.photo_id}','watercolor-source')
        for d in s.execute(select(WatermarkDraft.id,WatermarkDraft.name,WatermarkDraft.revision,WatermarkDraft.photo_id,WatermarkDraft.artwork_id,WatermarkDraft.asset_variant_id,WatermarkDraft.source_json)):
            g.node('watermark',d.id,d.name,revision=d.revision)
            if d.asset_variant_id:g.link(f'watermark:{d.id}',f'variant:{d.asset_variant_id}','watermark-source',d.source_json.get('document_revision'))
            elif d.artwork_id:g.link(f'watermark:{d.id}',f'watercolor:{d.artwork_id}','watermark-source',d.source_json.get('artwork_revision'))
            elif d.photo_id:g.link(f'watermark:{d.id}',f'photo:{d.photo_id}','watermark-source')
        for p in s.execute(select(CollageProject.id,CollageProject.record)):
            g.node('collage',p.id,p.record['name'],revision=p.record['revision'])
            if p.record['origin_library_id']==library:
                for link in p.record['photo_links']:g.link(f'collage:{p.id}',f'photo:{link["photo_id"]}','collage-source')
        for o in s.execute(select(CollageOutput.id,CollageOutput.record)):
            p=o.record['project'];g.node('collage-output',o.id,p['name']);g.link(f'collage-output:{o.id}',f'collage:{p["id"]}','rendered-from',p['revision'])
            if p['origin_library_id']==library:
                for link in p['photo_links']:g.link(f'collage-output:{o.id}',f'photo:{link["photo_id"]}','collage-source')
    return g.view(kind,id)
