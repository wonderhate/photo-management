import {current,allPhotoSources} from './storage';
import {AssetGraph} from '../core/derived-graph';
import type {AssetKind} from '../core/derived-graph';

export function derivedGraph(kind:AssetKind,id:string){
  const library=current(),g=new AssetGraph(),removed=new Set(library.removed_photos?.map(r=>r.photo.id)),photos=allPhotoSources(library);
  for(const p of photos){
    const key=g.node('photo',p.id,p.file_name,{removed:removed.has(p.id)}),group=p.capture_group_id||p.id;
    g.node('capture',group,group);g.link(key,`capture:${group}`,'capture-member');
    const origin=p.asset_origin||p.edit_origin;
    if(origin){g.node('variant',p.id,p.file_name,{removed:removed.has(p.id)});g.link(key,`variant:${p.id}`,'rendered-from');g.link(`variant:${p.id}`,`edit:${origin.document_id}`,'rendered-from',origin.document_revision);}
  }
  for(const raw of library.raw_sources||[])g.node('raw',raw.id,raw.file_name);
  for(const r of library.raw_relations||[])if(r.raw_id)g.link(`photo:${r.photo_id}`,`raw:${r.raw_id}`,'raw-source',r.revision);
  for(const edit of library.edits||[]){g.node('edit',edit.id,edit.source_name,{revision:edit.revision});if(edit.photo_id)g.link(`edit:${edit.id}`,`photo:${edit.photo_id}`,'edit-source');if(edit.derived_from)g.link(`edit:${edit.id}`,`variant:${edit.derived_from.variant_id}`,'edit-source',edit.derived_from.document_revision);}
  for(const split of library.splits||[]){g.node('split',split.id,split.id);g.link(`split:${split.id}`,`edit:${split.document_id}`,'split-source',split.document_revision);for(const panel of split.panels){g.node('variant',panel.id,panel.id);g.link(`variant:${panel.id}`,`split:${split.id}`,'split-source');}}
  for(const work of library.works){g.node('watercolor',work.id,work.source.file_name,{revision:work.revision});if(work.photo_id)g.link(`watercolor:${work.id}`,`photo:${work.photo_id}`,'watercolor-source');}
  for(const draft of library.drafts){g.node('watermark',draft.id,draft.name,{revision:draft.revision});if(draft.artwork_id)g.link(`watermark:${draft.id}`,`watercolor:${draft.artwork_id}`,'watermark-source',draft.source_revision);else if(draft.photo_id)g.link(`watermark:${draft.id}`,`photo:${draft.photo_id}`,'watermark-source');}
  for(const r of library.ai_results||[]){g.node('ai-result',r.id,r.source?.name||r.text||r.id);if(r.photo_id)g.link(`ai-result:${r.id}`,`photo:${r.photo_id}`,'ai-source');if(r.parent_id)g.link(`ai-result:${r.id}`,`ai-result:${r.parent_id}`,'ai-version');}
  for(const p of library.collages||[]){g.node('collage',p.id,p.name,{revision:p.revision});if(p.origin_library_id===library.id)for(const link of p.photo_links)g.link(`collage:${p.id}`,`photo:${link.photo_id}`,'collage-source');}
  for(const output of library.collage_outputs||[]){g.node('collage-output',output.id,output.project.name);g.link(`collage-output:${output.id}`,`collage:${output.project.id}`,'rendered-from',output.project.revision);if(output.project.origin_library_id===library.id)for(const link of output.project.photo_links)g.link(`collage-output:${output.id}`,`photo:${link.photo_id}`,'collage-source');}
  return g.view(kind,id);
}
