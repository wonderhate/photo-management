import {existingPhotoSource,allPhotoSources} from './storage';
import {watercolorLayout} from '../core/watercolor';
import {enterLibraryMutation} from './maintenance';
import {recyclable,recycleDerived,recycleHistory,restoreDerived} from './derived-recycle';
import {derivedGraph} from './derived-graph';
import type {AssetKind} from '../core/derived-graph';
import {sourceScanStatus,startSourceScan,waitForVisible,configureSourceScan} from './source-monitor';
import type {ScanOptions} from './source-monitor';
import {analyzedColor} from '../core/visual-hash';
import {locationFor,updateLocation} from './locations';
import {locationIndex} from '../core/location-index';
import {mapSummary,WORLD} from '../core/photo-map';
import {geoBounds} from '../core/photo-location';
import {discover} from '../core/discover';
import {registerRawSources,rawSuggestions,confirmRawSource} from './raw-sources';
import {analysisFor,appearance,appearanceGroups,startAppearanceIndex,colorCaptureIds} from './similarity';
import {cameraDay,timelinePrefix} from '../core/timeline';
import {analysisPeriod,analysisCounting,refineAnalysis} from '../core/analysis-scope';
import {removePhotoRecords,removedPhotoPage,restorePhotoRecords} from './remove-photo';
import {imageHeader} from './image-header';
import {captures,appendImportedPhotos} from './capture-groups';
import {automaticLogo,bundledFrameLogos,frameTokens} from '../core/frame-assets';
import {normalizeQueryScope} from '../core/query-scope';
import {normalizePhotoFacets,facetsQuery,withoutFacet} from '../core/photo-facets';
import type {FacetField} from '../core/photo-facets';
import {facetOptions} from './facet-options';
import {tagOptions as persistentTagOptions} from './tag-index-service';
import {TagIndex} from '../core/tag-index';
import type {TagOptions} from '../core/tag-index';
import type {Photo,WatermarkOptions,Job,ExportResult} from '../types';
import {launchTask,getTask,recentTasks,cancelTask,taskChildren,taskResources} from './task-service';
import type {TaskContext} from './task-service';
import {localPhotoSource} from '../core/media-source';
import {runLibraryLock,current,directory,librarySession,requireLibrary,isBrowsing,commit,assertCurrentRevision,uid,now,localFile,writeFile,imageURL,imageURLs,original,selectDirectory,connectSource,sourceHandle} from './storage';
import type {LocalPhoto,LocalAlbum,LocalDraft,LocalWork,Directory,ArtLayout,Library,MetadataSidecar} from './storage';
import {processImage} from './images';
import {isRawFile,isImportPhoto,isXmpFile} from './raw-file';
import {parseXmp,readXmp,XmpIndex} from './xmp';
import {supplementMetadata} from '../core/metadata';
import {sourceHash} from '../core/editor-adapter';
import {embeddedSourceProfile} from '../core/source-decode-profile';
import {photoOrder} from '../core/photo-order';
import {normalizePhotoQuery,compilePhotoQuery} from '../core/photo-query';
import {photoFlag} from '../core/photo-flag';
import {annotationView,annotationInput,editPhotoTags,applyAnnotation,userDescription} from '../core/photo-annotation';
import {externalRating} from '../core/photo-rating';
import {refreshExternalRating} from './rating-refresh';
import {albumMemberIds} from './album-members';
import {albumOverview,recentAlbumPhotos,captureMemberAdded,replaceMembers} from './album-overview';
import {matches,statistics,report,histogram,lensLifecycle} from './statistics';
import {browserError} from './text';
import {cloudRequest,cloudSettings,setCloudSettings} from './cloud';

const initial:WatermarkOptions={template:'frame',style:'modern_info_bar',show_brand_logo:true,info_bar_ratio:.14,font_scale:1,fields:['camera_make','camera_model','focal_length','f_number','exposure_time','iso','date_taken'],signature:'',signature_style:'text',theme:'white',border:.035,info_height:.16,font_size:1,align:'center',radius:.008,blur:.08,intensity:.85,brightness:.7,saturation:1.25,photo_scale:.88,shadow:true,format:'jpg',quality:95,long_edge:4096,filename_template:'{original}_watermark'};
function required<T extends {id:string}>(list:T[],id:string):T{const found=list.find(p=>p.id===id);if(!found)throw new Error('Record not found.');return found;}
const photo=(id:string)=>required(current().photos,id);
function filtered(q:URLSearchParams,ordered=true):LocalPhoto[]{
  q=new URLSearchParams(q);if(q.get('camera'))q.set('camera_model',q.get('camera')!);if(q.get('lens'))q.set('lens_model',q.get('lens')!);
  let baseIds:Set<string>|null=null,baseAlbum:string|undefined;
  if(q.has('scope')){const scope=normalizeQueryScope(q.get('scope'));if(scope.library_id!==current().id)throw new Error('Search scope belongs to another library.');q.set('count_mode',scope.mode);baseIds=new Set(filtered(new URLSearchParams({...scope.base,count_mode:scope.mode}),false).map(p=>p.id));baseAlbum=scope.base.album_id;}
  if(q.get('person_id'))throw new Error('Face recognition is not available in this browser release.');
  if(q.get('semantic'))throw new Error('Local semantic models are not available in this browser release.');
  for(const [key,field] of [['text','text'],['filename','file_name']])if(q.has(key))normalizePhotoQuery({version:1,root:{op:'icontains',field,value:q.get(key)}});
  const index=captures(current().photos),mode=q.get('count_mode')||current().settings.count_mode;
  if(mode!=='capture'&&mode!=='file')throw new Error('Invalid photo scope.');
  const type=q.get('file_type')||'all',plain=new URLSearchParams(q);plain.delete('file_type');
  if(!['all','raw','jpeg','paired','raw_only','jpeg_only'].includes(type))throw new Error('Invalid photo query.');
  const colorGroups=q.get('analyzed_color')?colorCaptureIds(current(),analyzedColor(q.get('analyzed_color'))):null;
  const locationIds=locationIndex(current().photos,current().photo_locations).filter(Object.fromEntries(q));
  let result=(mode==='capture'?index.representatives():current().photos).filter(p=>(!baseIds||baseIds.has(p.id))&&(!colorGroups||colorGroups.has(p.capture_group_id||p.id))&&index.matchesType(p,type)&&matches(p,Object.fromEntries(plain)));const album=q.get('album_id');
  if(locationIds)result=result.filter(p=>locationIds.has(p.id));
  if(q.has('facets')){const ast=facetsQuery(normalizePhotoFacets(q.get('facets')));if(ast)result=result.filter(compilePhotoQuery(ast));}
  if(q.has('query')){let value:unknown;try{const raw=q.get('query')!;if(new TextEncoder().encode(raw).length>32768)throw 0;value=JSON.parse(raw);}catch{throw new Error('Invalid photo query.');}result=result.filter(compilePhotoQuery(value));}
  if(album){const a=required(current().albums,album),ids=a.type==='rule'?new Set(albumMemberIds(a,current().photos)):index.idsForGroups(a.photo_ids);result=result.filter(p=>ids.has(p.id));}
  if(!ordered)return result;const orderedAlbum=baseAlbum||album;
  if(orderedAlbum&&q.get('sort')==='manual'){const a=required(current().albums,orderedAlbum),positions=new Map<string,number>();albumMemberIds(a,current().photos).forEach((id,position)=>{for(const member of index.idsForGroups([id]))if(!positions.has(member))positions.set(member,position);});if(a.type!=='rule')return result.sort((a,b)=>positions.get(a.id)!-positions.get(b.id)!||a.id.localeCompare(b.id));}
  return result.sort(photoOrder(q.get('sort'),q.get('direction')));
}
function paged<T>(list:T[],q:URLSearchParams){const size=Math.min(200,Math.max(1,Number(q.get('page_size'))||80)),page=Math.max(1,Number(q.get('page'))||1);return list.slice((page-1)*size,page*size);}
export function mediaURL(id:string,kind='thumbnail'){return localPhotoSource(current().id,`photos/${id}-${kind==='thumbnail'?'thumb':'preview'}.jpg`);}
async function hydrate(p:LocalPhoto):Promise<Photo>{const ready=(p.preview_status||'ready')==='ready',groupIds=captures(current().photos).idsForGroups([p.id]);return {...p,files:captures(current().photos).files(p),...annotationView(p),flag:photoFlag(p.flag),preview_status:p.preview_status||'ready',thumbnail_path:ready?`photos/${p.id}-thumb.jpg`:null,thumbnail_url:ready?mediaURL(p.id):'',preview_url:ready?mediaURL(p.id,'preview'):'',missing:!p.managed_path&&!sourceHandle(p.source_id),watermark_draft_count:current().drafts.filter(d=>d.photo_id&&groupIds.has(d.photo_id)).length};}
function album(a:LocalAlbum){return albumOverview(a,current().photos);}
async function removeAlbums(ids:unknown){
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)))throw new Error('影集选择无效');
  const selected=new Set<string>(ids);
  await commit(v=>{
    if(ids.some(id=>!v.albums.some(a=>a.id===id)))throw new Error('部分影集已不存在，请刷新列表');
    v.albums=v.albums.filter(a=>!selected.has(a.id));
    if(v.album_preferences?.order)v.album_preferences.order=v.album_preferences.order.filter(id=>!selected.has(id));
  });
  return {deleted:selected.size,originals_untouched:true};
}
async function draft(d:LocalDraft){const p=d.photo_id?existingPhotoSource(d.photo_id):null;return {...d,preview_url:d.preview_file?await imageURL(d.preview_file):null,modified_since_export:d.exported_revision!=null&&d.revision>d.exported_revision,source_missing:d.artwork_id?!current().works.some(w=>w.id===d.artwork_id):!p||(!p.managed_path&&!sourceHandle(p.source_id))};}
async function work(w:LocalWork){const [preview_url,scene_url,poster_url]=await imageURLs([`works/${w.id}/preview-${w.revision}.webp`,`works/${w.id}/scene.png`,`works/${w.id}/poster-${w.revision}.png`]);return {...w,preview_url,scene_url,poster_url};}
async function hydrateJob(j:Job){const result=structuredClone(j);result.results=await Promise.all(result.results.map(async r=>({...r,url:r.path?.startsWith('exports/')?await imageURL(r.path):r.url})));return result;}
async function* files(handle:Directory,prefix='',recursive=true,check?:()=>Promise<void>):AsyncGenerator<{file:File;path:string}>{for await(const entry of handle.values()){await check?.();const path=prefix+entry.name;if(entry.kind==='directory'){if(recursive)yield* files(await handle.getDirectoryHandle(entry.name) as Directory,path+'/',recursive,check);}else yield {file:await (await handle.getFileHandle(entry.name)).getFile(),path};}}
export function importSelectedFiles(selected:File[]){if(selected.some(file=>isXmpFile(file.name))&&!selected.some(file=>isImportPhoto(file.name)))throw new Error(browserError('Choose photos together with their XMP sidecars.'));return importSources([],false,selected);}
export async function importSources(paths:string[],recursive=true,selected:File[]=[],scan:ScanOptions={}){
  const tokens=[...paths],picked=[...selected];
  return launchTask('import',async root=>{
    const candidates:{file:File;path:string;sourceId:string;displayPath:string}[]=[],supported=(file:File)=>isImportPhoto(file.name),xmp=new XmpIndex();
    await root.stage('import-scan',async context=>{
      const j=context.job;j.phase='scanning';
      for(const file of picked){if(supported(file)){candidates.push({file,path:file.name,sourceId:'',displayPath:file.name});xmp.addPhoto('',file.name);}else if(isXmpFile(file.name))xmp.add({file,path:file.name,sourceId:'',read:async()=>file});}
      for(const token of tokens){
        context.check();const sourceId=token.replace(/^source:/,''),handle=sourceHandle(sourceId);
        if(!handle)throw new Error('Select the original photo directory first.');
        try{for await(const {file,path} of files(handle,'',recursive,async()=>{context.check();if(scan.automatic)await waitForVisible(context.signal);context.check();})){context.check();if(supported(file)){scan.seen?.(sourceId,path,file);if(!scan.accept||scan.accept(sourceId,path,file))candidates.push({file,path,sourceId,displayPath:handle.name+'/'+path});xmp.addPhoto(sourceId,path);}else if(isXmpFile(file.name))xmp.add({file,path,sourceId,read:()=>localFile(path,handle)});}}
        catch(error){context.check();if(!scan.automatic)throw error;scan.failed?.(sourceId);}
      }
      j.total=j.processed=j.success=candidates.length;await context.checkpoint(true);
    });
    await root.stages([{kind:'import-index',resource:'io',mirror:true},{kind:'import-preview',resource:'render',mirror:false}],async([context,preview])=>{
      const j=context.job,pj=preview.job;j.total=candidates.length;j.phase='processing';await context.activate();
      let pending:LocalPhoto[]=[],batchStarted=performance.now();const waiting=new Set<string>(),seen=new Set<string>();
      root.job.preview_total=root.job.preview_processed=root.job.preview_failed=0;
      const enqueue=(id:string)=>{if(seen.has(id))return;seen.add(id);waiting.add(id);pj.total++;root.job.preview_total=pj.total;};
      const flushMetadata=async()=>{if(!pending.length)return;const batch=pending;let accepted=batch.length;await context.commit(v=>{const removed=v.removed_photos||[],eligible=scan.automatic?batch.filter(p=>!removed.some(r=>r.photo.file_hash===p.file_hash||r.photo.source_id===p.source_id&&r.photo.relative_path===p.relative_path)):batch;accepted=eligible.length;appendImportedPhotos(v.photos,eligible);root.job.new_photo_ids=[...new Set([...(root.job.new_photo_ids||[]),...eligible.map(p=>p.id)])].slice(0,10000);},true);j.success+=accepted;j.skipped+=batch.length-accepted;pending=[];await context.checkpoint(true);};
      const flushPreviews=async()=>{
        await flushMetadata();if(!waiting.size)return;
        root.job.phase='previews';await preview.checkpoint(true);
        for(const id of waiting){
          preview.check();const snapshot=current().photos.find(p=>p.id===id);pj.current=snapshot?.file_name||'';
          await preview.render(async()=>{
            let settled=false;
            try{
              const source=current().photos.find(p=>p.id===id);
              if(!source){pj.skipped++;settled=true;return;}
              const raw=isRawFile(source.file_name),result=await processImage<any>('previews',{file:await preview.original(source),profile:source.decode_profile},raw?preview.signal:undefined);
              if(raw)await preview.original(source);
              // Finish this image on cancellation, but never publish into a
              // newly opened library or restore a row removed during decode.
              preview.check(true);await preview.write(`photos/${id}-thumb.jpg`,result.thumbnail,true);await preview.write(`photos/${id}-preview.jpg`,result.preview,true);
              let published=false;await preview.commit(v=>{const p=v.photos.find(p=>p.id===id);if(p&&p.file_hash===source.file_hash){p.width=result.width;p.height=result.height;p.preview_source=result.source;p.preview_status='ready';p.preview_error=null;p.thumbnail_path=`photos/${id}-thumb.jpg`;p.files.forEach(f=>f.preview_available=true);published=true;}},true);if(published)pj.success++;else pj.skipped++;settled=true;
            }catch(error){
              preview.check();const message=error instanceof Error?error.message:'Import failed.';
              await preview.commit(v=>{const p=v.photos.find(p=>p.id===id);if(p&&p.file_hash===snapshot?.file_hash){p.preview_status='failed';p.preview_error=message;}},true);
              pj.failed++;root.job.preview_failed=pj.failed;if(pj.errors.length<20)pj.errors.push((snapshot?.file_name||id)+': '+message);settled=true;
            }finally{if(settled){pj.processed++;root.job.preview_processed=pj.processed;}await preview.checkpoint();}
          });
          waiting.delete(id);preview.check();
        }
        pj.status='queued';pj.current='';root.job.phase='processing';root.job.active_child_id=context.job.status==='completed'?null:context.job.id;await preview.checkpoint(true);batchStarted=performance.now();
      };
      try{for(const {file,path,sourceId,displayPath} of candidates){
        if(scan.automatic)await waitForVisible(context.signal);
        context.check();j.phase='processing';await context.activate();j.current=file.name;
        try{
          if(scan.automatic&&current().removed_photos?.some(r=>r.photo.source_id===sourceId&&r.photo.relative_path===path)){j.skipped++;j.processed++;await context.checkpoint();continue;}
          const result=await processImage<any>('metadata',{file},context.signal);context.check();
          if(current().removed_photos?.some(r=>r.photo.file_hash===result.digest)){j.skipped++;j.processed++;await context.checkpoint();continue;}
          const duplicate=current().photos.find(p=>p.file_hash===result.digest)||pending.find(p=>p.file_hash===result.digest);
          if(duplicate){
            try{if(duplicate.managed_path||duplicate.source_id!==sourceId||duplicate.relative_path!==path)await context.original(duplicate);}
            catch(error){
              context.check();const managedPath=sourceId?undefined:`photos/${uid()}-original.${file.name.split('.').at(-1)!.toLowerCase()}`;
              if(managedPath)await context.write(managedPath,file);
              const reconnect=(p:LocalPhoto)=>{p.source_id=sourceId;p.relative_path=path;p.file_path=displayPath;p.file_name=file.name;p.managed_path=managedPath;};
              if(pending.includes(duplicate))reconnect(duplicate);else await context.commit(v=>reconnect(required(v.photos,duplicate.id)));
            }
            let needsPreview=duplicate.preview_status==='pending'||duplicate.preview_status==='failed';
            if(!needsPreview&&!pending.includes(duplicate))try{await context.file(`photos/${duplicate.id}-thumb.jpg`);await context.file(`photos/${duplicate.id}-preview.jpg`);}catch{context.check();needsPreview=true;}
            if(needsPreview)enqueue(duplicate.id);j.skipped++;
          }else{
            if(sourceId&&current().photos.some(p=>p.source_id===sourceId&&p.relative_path===path&&!p.managed_path)){scan.changed?.(sourceId);throw new Error('The original path contains different content. Remove the old record before importing a replacement.');}
            const id=uid(),managedPath=sourceId?undefined:`photos/${id}-original.${file.name.split('.').at(-1)!.toLowerCase()}`;
            const embeddedTags=result.embeddedXmp?parseXmp(result.embeddedXmp):null;
            if(embeddedTags)result.metadata=supplementMetadata(result.metadata,embeddedTags,'xmp-embedded');
            const decode_profile=embeddedSourceProfile(result.jpeg,result.explicitOrientation,embeddedTags);
            if(decode_profile.extra_orientation!==1){
              if(decode_profile.extra_orientation>=5)[result.width,result.height]=[result.height,result.width];
              result.metadata.orientation=decode_profile.extra_orientation;
              const origins=JSON.parse(result.metadata.raw_exif['PhotoCollection:MetadataSources']||'{}');origins.orientation='xmp-embedded';result.metadata.raw_exif['PhotoCollection:MetadataSources']=JSON.stringify(origins);
            }
            const metadataSidecars:MetadataSidecar[]=[],xmpTags:Record<string,unknown>={};
            for(const candidate of xmp.forPhoto(sourceId,path)){
              const record=await readXmp(candidate,()=>context.check());if(!record)continue;
              Object.assign(xmpTags,record.tags);
              result.metadata.raw_exif['Sidecar:'+record.name+':SHA256']=record.sha256;
              const sidecarPath=sourceId?undefined:`photos/${id}-metadata-${metadataSidecars.length}-${record.sha256}.xmp`;
              if(sidecarPath)await context.write(sidecarPath,record.file);
              metadataSidecars.push({name:record.name,sha256:record.sha256,photo_hash:result.digest,relative_path:record.path,source_id:sourceId,managed_path:sidecarPath});
            }
            if(metadataSidecars.length)result.metadata=supplementMetadata(result.metadata,xmpTags,'xmp-sidecar');
            context.check();
            const originalNow=sourceId?await localFile(path,sourceHandle(sourceId)!):file;
            if(await sourceHash(originalNow)!==result.digest)throw new Error('The source photo changed. Reopen it before saving.');context.check();
            if(managedPath)await context.write(managedPath,file);
            const p:LocalPhoto={id,capture_group_id:id,source_id:sourceId,relative_path:path,managed_path:managedPath,metadata_sidecars:metadataSidecars,decode_profile,file_hash:result.digest,file_name:file.name,file_path:displayPath,file_format:file.name.split('.').at(-1)!.toUpperCase(),is_raw:isRawFile(file.name),file_size:file.size,width:result.width,height:result.height,created_at:now(),favorite:false,flag:'unmarked',color_label:null,tags:[],files:[],thumbnail_url:'',preview_url:'',thumbnail_path:null,preview_status:'pending',preview_error:null,...result.metadata,...externalRating(result.metadata.raw_exif)};
            p.files=[{id,file_name:p.file_name,file_format:p.file_format,is_raw:p.is_raw,file_path:p.file_path,preview_available:false}];pending.push(p);enqueue(id);
          }
        }catch(error){context.check();j.failed++;if(j.errors.length<20)j.errors.push(file.name+': '+(error instanceof Error?error.message:'Import failed.'));}
        j.processed++;await context.checkpoint();
        if(waiting.size>=(pj.processed?100:24)||performance.now()-batchStarted>=8000)await flushPreviews();
      }}finally{await flushMetadata();}
      j.phase='processing';await context.complete();await flushPreviews();root.job.phase='processing';await preview.complete();
      scan.done?.(!j.failed);
    });
  });
}
function filename(name:string){const safe=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,160)||'photo';return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe)?'_'+safe:safe;}
export async function exported(blob:Blob,name:string,context?:TaskContext):Promise<ExportResult>{
  const scope=current().id,base=context?.base||directory(),generation=context?.generation??librarySession();
  const check=(allowCancelled=false)=>{if(context)context.check(allowCancelled);else if(current().id!==scope||directory()!==base||librarySession()!==generation)throw new Error('Library changed. Reopen the current library.');};
  return runLibraryLock('photocollection-export:'+scope,async()=>{
    check();const extension=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':blob.type==='image/jpeg'?'jpg':null;if(!extension||!blob.size)throw new Error('Invalid encoded image format.');const requested=name.split('.').at(-1)?.toLowerCase();if(requested&&['jpg','jpeg','png','webp'].includes(requested)&&(requested==='jpeg'?'jpg':requested)!==extension)throw new Error('Encoded image format differs from the request.');const dimensions=imageHeader(new Uint8Array(await blob.arrayBuffer()));if(!dimensions)throw new Error('Invalid encoded image format.');const sha256=await sourceHash(blob);check();let target=filename(name.replace(/\.[^.]+$/,''))+'.'+extension,i=1;
    while(true){check();try{await localFile('exports/'+target,base);target=filename(name.replace(/\.[^.]+$/,''))+'-'+i+++'.'+extension;}catch(error){if(!(error instanceof DOMException)||error.name!=='NotFoundError')throw error;break;}}
    // Never overwrite a registered original even if it lives under exports.
    const registered=new Set(allPhotoSources().map(p=>p.managed_path||p.relative_path));
    if(registered.has('exports/'+target))throw new Error('Output conflicts with a registered original.');
    check();await writeFile('exports/'+target,blob,base);check(true);if(await sourceHash(await localFile('exports/'+target,base))!==sha256)throw new Error('Export verification failed; no successful result was recorded.');check(true);const url=await imageURL('exports/'+target);check(true);return {url,path:'exports/'+target,file_name:target,...dimensions,sha256,format:extension,metadata_policy:'pixels-only-srgb'};
  });
}
async function draftSource(d:LocalDraft,context?:TaskContext){
  if(d.artwork_id)return context?context.file(`works/${d.artwork_id}/poster-${d.source_revision}.png`):localFile(`works/${d.artwork_id}/poster-${d.source_revision}.png`);
  const p=existingPhotoSource(d.photo_id||'');if(!p)throw new Error('Photo record no longer exists.');
  if(context)return context.original(p);
  const file=await original(p);if(await sourceHash(file)!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');return file;
}
async function renderDraft(d:LocalDraft,options=d.settings_json,preview=true,context?:TaskContext){
  const generation=librarySession(),file=await draftSource(d,context),before=await sourceHash(file),expected=d.artwork_id?d.source.artwork_poster_hash:d.source.file_hash;
  if(expected&&before!==expected)throw new Error('The source photo changed. Reopen it before saving.');
  const result=await processImage<Blob>('watermark',{file,photo:d.source,options,preview},context?.signal);
  if(generation!==librarySession())throw new Error('Library changed. Reopen the current library.');context?.check();
  if(!preview&&await sourceHash(await draftSource(d,context))!==before)throw new Error('The source photo changed. Reopen it before saving.');return result;
}
async function saveDraft(body:any,id?:string){return runLibraryLock('photocollection-work:'+current().id+':'+(id||uid()),async()=>{await assertCurrentRevision();const previous=id?required(current().drafts,id):null;if(previous&&body.revision!==previous.revision)throw new Error('This work changed in another window. Reopen it before editing.');const p=previous?null:photo(body.photo_id);const d:LocalDraft=previous?structuredClone(previous):{id:uid(),photo_id:p!.id,capture_group_id:p!.capture_group_id,name:p!.file_name,watermark_type:'frame',template_id:'frame',settings_json:initial,preview_url:null,status:'draft',revision:0,created_at:now(),updated_at:now(),last_exported_at:null,export_path:null,modified_since_export:true,source_missing:false,source:{file_name:p!.file_name,file_path:p!.file_path,camera_model:p!.camera_model,lens_model:p!.lens_model,date_taken:p!.date_taken,...p}};
  d.settings_json={...d.settings_json,...body.settings_json};if(previous&&JSON.stringify(d.settings_json)!==JSON.stringify(previous.settings_json))d.status='draft';d.name=String(body.name||d.name).slice(0,180);d.watermark_type=d.settings_json.template;d.template_id=d.settings_json.template;d.revision++;d.updated_at=now();d.preview_file=`drafts/${d.id}/preview-${d.revision}.webp`;await writeFile(d.preview_file,await renderDraft(d));await commit(s=>{if(previous)s.drafts[s.drafts.findIndex(v=>v.id===d.id)]=d;else s.drafts.push(d);});return draft(d);});
}
async function exportDraft(d:LocalDraft,options:any,context?:TaskContext,index=1){
  const merged={...d.settings_json,...Object.fromEntries(Object.entries(options).filter(([key])=>['format','quality','long_edge','filename_template'].includes(key)))},result=await exported(await renderDraft(d,merged,false,context),outputName(d.source,merged,index),context);
  const change=(s:Library)=>{const item=s.drafts.find(x=>x.id===d.id);if(!item||Number(item.exported_revision||0)>d.revision)return;if(item.revision===d.revision)item.status='exported';item.exported_revision=d.revision;item.last_exported_at=now();item.export_path=result.path||null;};
  if(context)await context.commit(change,true);else await commit(change);return {...result,draft_id:d.id,draft_revision:d.revision};
}
function outputName(source:Record<string,any>,o:WatermarkOptions,index:number){return (o.filename_template||'{original}_watermark').replaceAll('{original}',source.file_name.replace(/\.[^.]+$/,'')).replaceAll('{date}',(source.date_taken||source.created_at||now()).slice(0,10)).replaceAll('{camera}',source.camera_model||'camera').replaceAll('{index}',String(index).padStart(3,'0'))+'.'+o.format;}
async function nextPosterRevision(w:LocalWork){
  const scope=librarySession();
  for(let revision=w.revision+1;revision<=w.revision+1000;revision++){
    let occupied=false;
    for(const path of [`works/${w.id}/poster-${revision}.png`,`works/${w.id}/preview-${revision}.webp`]){
      try{await localFile(path);occupied=true;}catch(error){if(!(error instanceof DOMException)||error.name!=='NotFoundError')throw error;}
      if(scope!==librarySession())throw new Error('Library changed. Reopen the current library.');
    }
    if(!occupied)return revision;
  }
  throw new Error('Too many unfinished artwork versions; review derived files before saving');
}
async function savePoster(w:LocalWork,context?:TaskContext){
  w.layout=watercolorLayout(w.layout);
  const source=await (context?context.file(`works/${w.id}/scene.png`):localFile(`works/${w.id}/scene.png`)),size:[number,number]=[w.source.width,w.source.height];
  for(const [path,preview] of [[`works/${w.id}/poster-${w.revision}.png`,false],[`works/${w.id}/preview-${w.revision}.webp`,true]] as const){const result=await processImage<Blob>('poster',{file:source,layout:w.layout,originalSize:size,preview},context?.signal);if(context)await context.write(path,result);else await writeFile(path,result);}
}
async function tagOptions(options:TagOptions,signal?:AbortSignal){signal?.throwIfAborted();return isBrowsing()?new TagIndex([]).query(options):persistentTagOptions(options,signal);}
export async function browserBlob(path:string,body:any):Promise<Blob>{
  const parts=path.split('/').filter(Boolean);
  if(path==='/watermark/preview'){const p=photo(body.photo_id);return processImage('watermark',{file:await original(p),photo:p,options:body.options,preview:true});}
  if(parts[0]==='watermark'&&parts[1]==='drafts')return renderDraft(required(current().drafts,parts[2]),body,true);
  if(parts[0]==='art'&&parts[1]==='works'){const w=required(current().works,parts[2]);return processImage('poster',{file:await localFile(`works/${w.id}/scene.png`),layout:body,originalSize:[w.source.width,w.source.height],preview:true});}
  throw new Error('Unsupported local image operation.');
}
export async function browserAPI<T>(path:string,method='GET',body:any={},signal?:AbortSignal):Promise<T>{let leave:(()=>void)|undefined;try{signal?.throwIfAborted();if(!['GET','HEAD','OPTIONS'].includes(method)&&!(method==='POST'&&new URL(path,'https://local.invalid').pathname==='/photos/by-ids'))requireLibrary();if(!['GET','HEAD','OPTIONS'].includes(method)&&!/^\/removals\/derived(?:\/|$|\?)/.test(path))leave=enterLibraryMutation();return await route(path,method,body,signal) as T;}catch(e){if(e instanceof DOMException&&e.name==='AbortError')throw e;throw new Error(browserError(e));}finally{leave?.();}}
async function route(path:string,method:string,body:any,signal?:AbortSignal):Promise<unknown>{
  const url=new URL(path,'https://local.invalid'),q=url.searchParams,parts=url.pathname.split('/').filter(Boolean),s=current();
  if(parts[0]==='ai')return (await import('./ai-studio')).browserStudio(path,method,body);
  if(parts[0]==='assets'&&parts[1]==='graph'&&method==='GET')return derivedGraph(q.get('kind') as AssetKind,q.get('id')||'');
  if(parts[0]==='removals'&&parts[1]==='derived'){
    if(parts.length===2&&method==='GET')return recyclable(Number(q.get('page')||1));
    if(parts.length===2&&method==='POST'){if(!body||Object.keys(body).some(k=>k!=='items'))throw new Error('Invalid derived recycle record.');return recycleDerived(body.items);}
    if(parts[2]==='history'&&method==='GET')return recycleHistory(Number(q.get('page')||1));
    if(parts[3]==='restore'&&method==='POST')return restoreDerived(parts[2]);
  }
  if(parts[0]==='health')return {status:'ok',version:'2.5.1',data_dir:s.settings.data_dir,exports_dir:'exports'};
  if(parts[0]==='removals'&&parts[1]==='photos'){
    if(parts.length===2&&method==='GET')return removedPhotoPage(s,Number(q.get('page')||1),Number(q.get('page_size')||40));
    if(parts[2]==='restore'&&method==='POST'){let result;await commit(v=>{result=restorePhotoRecords(v,body?.ids);});return result;}
    throw new Error('Invalid removal history selection.');
  }
  if(parts[0]==='raw-sources'){
    if(parts[1]==='register'&&method==='POST'){if(!body||Object.keys(body).some(k=>k!=='paths'))throw new Error('Choose a RAW source folder.');return registerRawSources(body.paths);}
    if(parts[1]==='photos'&&parts.length===3){if(method==='GET')return rawSuggestions(parts[2],q.get('q')||'',Number(q.get('page')||1),Number(q.get('page_size')||20));if(method==='PUT')return confirmRawSource(parts[2],body);}
    throw new Error('Invalid RAW source query.');
  }
  if(parts[0]==='locations'&&parts[1]==='photos'&&parts.length===3){if(method==='GET')return locationFor(parts[2]);if(method==='PUT')return updateLocation(parts[2],body);throw new Error('Invalid photo location.');}
  if(parts[0]==='locations'&&parts[1]==='discover'&&method==='GET'){
    const mode=q.get('count_mode')||'capture';if(mode!=='capture'&&mode!=='file')throw new Error('Invalid photo scope.');
    return discover(mode==='capture'?captures(s.photos).representatives():s.photos,s.photo_locations||[],q.get('day')||'',mode);
  }
  if(parts[0]==='locations'&&parts[1]==='map'&&method==='GET'){
    let bounds=WORLD;try{const value=q.get('viewport');if(value){if(value.length>512)throw 0;bounds=geoBounds(JSON.parse(value));}}catch{throw new Error('Invalid map bounds.');}
    return mapSummary(locationIndex(current().photos,current().photo_locations),filtered(q,false).map(p=>p.id),bounds);
  }
  if(parts[0]==='similarity'){
    if(parts[1]==='index'&&method==='POST')return startAppearanceIndex();
    if(parts[1]==='groups'&&method==='GET'){const result=await appearanceGroups(q.get('after')||'',Number(q.get('distance')||6),Number(q.get('limit')||12),signal);return {...result,groups:await Promise.all(result.groups.map(async group=>({...group,source:await hydrate(group.source),candidates:await Promise.all(group.candidates.map(hydrate))})))};}
    if(parts[1]==='photos'&&parts[2]&&method==='GET'){
      if(parts[3]==='analysis')return analysisFor(parts[2]);
      const mode=q.get('mode')||'appearance';if(!['appearance','semantic'].includes(mode))throw new Error('Invalid similarity mode.');
      if(mode==='semantic'||q.get('verify')==='true')throw new Error('Local semantic models are not available in this browser release.');
      const result=await appearance(parts[2],Number(q.get('distance')||6),Number(q.get('limit')||60),signal);
      return {...result,candidates:await Promise.all(result.candidates.map(hydrate))};
    }
    throw new Error('Record not found.');
  }
  if(parts[0]==='settings'){if(method==='PUT'){const bands=body.focal_bands;if(!Array.isArray(bands)||bands.length!==5||bands.some((v,i)=>!Number.isFinite(v)||v<=0||(i>0&&v<=bands[i-1])))throw new Error('Enter five increasing positive focal length boundaries.');await commit(v=>{for(const key of ['thumbnail_quality','count_mode','export_format','export_quality','export_long_edge','focal_bands'] as const)if(body[key]!==undefined)(v.settings as any)[key]=body[key];});}return current().settings;}
  if(parts[0]==='plugins')return [];
  if(parts[0]==='ai'){if(method!=='GET')throw new Error('Local semantic models are not available in this browser release.');return {status:'unavailable',stage:'Local semantic models are not available in this browser release.',model:'',device:'Browser',available:false,processed:0,total:0,indexed:0,failed:0,cached_bytes:0,error:null};}
  if(parts[0]==='faces')throw new Error('Face recognition is not available in this browser release.');
  if(parts[0]==='library'&&parts[1]==='scan')return method==='PUT'?configureSourceScan(body):method==='POST'?startSourceScan(q.get('force')==='true'):sourceScanStatus();
  if(parts[0]==='library')return {paths:s.sources.map(v=>v.name),job:null};
  if(parts[0]==='dialog'){const handle=await selectDirectory('read'),id=await connectSource(handle);return {paths:['source:'+id]};}
  if(parts[0]==='jobs'){
    if(parts[1]){if(parts[2]==='children'){const page=Number(q.get('page')||1),size=Number(q.get('page_size')||20);if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1||size>100)throw new Error('Invalid pagination.');return taskChildren(parts[1],page,size);}if(parts[2]==='cancel')return hydrateJob(await cancelTask(parts[1]));return hydrateJob(getTask(parts[1]));}
    return q.get('summary')==='true'?recentTasks(true):Promise.all((recentTasks() as Job[]).map(hydrateJob));
  }
  if(parts[0]==='tasks'&&parts[1]==='resources')return taskResources();
  if(parts[0]==='facets'){const field=parts[1] as FacetField,base=new URLSearchParams(withoutFacet(Object.fromEntries(q),field));if(field==='tag')return tagOptions({ids:filtered(base,false).map(p=>p.id),term:q.get('q')||'',page:Number(q.get('page')||1),size:Number(q.get('page_size')||60)},signal);return facetOptions(filtered(base,false),field,q.get('q')||'',Number(q.get('page')||1),Number(q.get('page_size')||60));}
  if(parts[0]==='tags')return tagOptions({ids:filtered(q,false).map(p=>p.id),term:q.get('q')||'',page:Number(q.get('page')||1),size:Number(q.get('page_size')||60),order:(q.get('order')||'name') as 'name',origins:true},signal);
  if(parts[0]==='filter-options'){const base=new URLSearchParams(q);base.delete('include_tags');const photos=filtered(base),fields=['camera_model','lens_model','focal_length','f_number','iso','exposure_seconds',...(q.get('include_tags')==='false'?[]:['tags'])];return Object.fromEntries(fields.map(key=>[key,[...new Set(photos.flatMap(p=>key==='tags'?p.tags:p[key as keyof Photo]!=null?[p[key as keyof Photo]]:[]))].sort((a,b)=>typeof a==='number'&&typeof b==='number'?a-b:String(a)<String(b)?-1:String(a)>String(b)?1:0)]));}
  if(parts[0]==='search')return {filters:{search:q.get('q')||''},interpreted:[],remaining_query:''};
  if(parts[0]==='compare'&&method==='GET'){
    const ids=(q.get('ids')||'').split(',').filter(Boolean);
    if(ids.length<2||ids.length>4||new Set(ids).size!==ids.length)throw new Error('Invalid photo selection.');
    return {photos:await Promise.all(ids.map(id=>hydrate(photo(id))))};
  }
  if(parts[0]==='photos'){
    if(parts[1]==='import')return importSources(body.paths,body.recursive);
    if(parts[1]==='ids')return {ids:filtered(q).map(p=>p.id)};
    if(parts[1]==='by-ids')return {photos:await Promise.all((body.ids as string[]).slice(0,200).map(id=>hydrate(photo(id))))};
    if(parts[1]==='batch-edit'){if(!Array.isArray(body.photo_ids)||body.photo_ids.length>100000)throw new Error('Invalid photo selection.');await commit(v=>{for(const id of new Set<string>(body.photo_ids)){const p=required(v.photos,id);if(body.flag!==undefined)p.flag=photoFlag(body.flag);if(body.favorite!==undefined)p.favorite=!!body.favorite;if(body.clear_rating){p.rating=null;p.rating_source='manual';}else if(body.rating!==undefined){if(!Number.isInteger(body.rating)||body.rating<0||body.rating>5)throw new Error('Rating must be between 0 and 5.');p.rating=body.rating;p.rating_source='manual';}if(body.clear_color_label)p.color_label=null;else if(body.color_label!==undefined)p.color_label=body.color_label==='none'?null:body.color_label;if(body.user_description!==undefined)p.user_description=userDescription(body.user_description);if(body.add_tags||body.remove_tags)Object.assign(p,editPhotoTags(p,body));}});return {updated:body.photo_ids.length};}
    if(parts[2]==='rating'&&parts[3]==='refresh'&&method==='POST'){const result=await refreshExternalRating(photo(parts[1]));return {...result,photo:await hydrate(result.photo)};}
    if(parts[2]==='annotation'&&method==='POST'){const input=annotationInput(body),id=parts[1];await commit(v=>{const p=required(v.photos,id);if(p.file_hash!==input.source_hash||(p.annotation?.revision||0)!==input.expected_revision)throw new Error('Annotation source or revision changed. Reload the photo.');Object.assign(p,applyAnnotation(p,input.annotation));});return hydrate(photo(id));}
    if(parts[1]){const p=photo(parts[1]);if(method==='PATCH'){if(body.rating!==undefined&&body.rating!==null&&(!Number.isInteger(body.rating)||body.rating<0||body.rating>5))throw new Error('Rating must be between 0 and 5.');if(body.tags!==undefined&&(!Array.isArray(body.tags)||body.tags.length>200||body.tags.some((t:unknown)=>typeof t!=='string'||t.length>200)))throw new Error('Invalid photo tags.');await commit(v=>{const item=required(v.photos,p.id);for(const key of ['favorite','rating','color_label'] as const)if(body[key]!==undefined)(item as any)[key]=key==='color_label'&&body[key]==='none'?null:body[key];if(body.rating!==undefined)item.rating_source='manual';if(body.flag!==undefined)item.flag=photoFlag(body.flag);if(body.user_description!==undefined)item.user_description=userDescription(body.user_description);if(body.tags!=null||body.add_tags||body.remove_tags||body.restore_ai_tags)Object.assign(item,editPhotoTags(item,{...body,tags:body.tags??undefined}));});return hydrate(photo(p.id));}if(method==='DELETE'){let removed=0;await commit(v=>{removed=removePhotoRecords(v,p.id,q.get('scope')||'capture');});return {ok:true,removed};}return hydrate(p);}
    const list=filtered(q);return {photos:await Promise.all(paged(list,q).map(hydrate)),total:list.length};
  }
  if(parts[0]==='albums'){
    if(parts[1]==='batch-delete'&&method==='POST')return removeAlbums(body.ids);
    if(parts[1]==='smart')throw new Error('Local semantic models are not available in this browser release.');
    if(parts[1]==='rules'&&parts[2]==='preview'&&method==='POST'){const matches=compilePhotoQuery(body.query),rows=captures(s.photos).representatives().filter(matches).sort(photoOrder('date_taken','desc'));return {total:rows.length,candidates:await Promise.all(rows.slice(0,12).map(hydrate))};}
    if(!parts[1]){
      if(method==='GET'){const byId=new Map(s.photos.map(p=>[p.id,p]));return s.albums.map(a=>albumOverview(a,s.photos,byId));}
      if(!String(body.name||'').trim())throw new Error('Enter an album name.');
      const type=body.type||'normal';if(!['normal','rule'].includes(type))throw new Error('Invalid photo query.');
      const query=type==='rule'?normalizePhotoQuery(body.query):null;
      if(type==='rule'&&(body.person_id||body.photo_ids?.length||body.keywords?.length||Object.keys(body.scores||{}).length)||type!=='rule'&&body.query!=null)throw new Error('Invalid photo query.');
      const stamp=now(),a:LocalAlbum={id:uid(),name:String(body.name).trim().slice(0,120),type,query,count:0,keywords:[],match_mode:'all',threshold:.38,max_results:100,ai_model:null,cover_id:null,cover_mode:'auto',created_at:stamp,updated_at:stamp,photo_ids:[]};
      replaceMembers(a,type==='rule'?[]:body.photo_ids||[],stamp);await commit(v=>v.albums.push(a));return album(a);
    }
    const a=required(s.albums,parts[1]);if(method==='DELETE'){await removeAlbums([a.id]);return {ok:true};}
    if(parts[2]==='recent'&&method==='GET'){
      const page=Number(q.get('page')||1),size=Number(q.get('page_size')||24);
      if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100)throw new Error('分页参数超出范围');
      const rows=recentAlbumPhotos(a,s.photos),window=rows.slice((page-1)*size,page*size);
      return {photos:await Promise.all(window.map(async p=>({...await hydrate(p),album_added_at:a.type==='rule'?null:captureMemberAdded(a,p,s.photos)}))),total:rows.length,recent_kind:a.type==='rule'?'imported':'joined'};
    }
    if(method==='PUT'||method==='PATCH'||method==='POST'){
      if(a.type==='rule'&&['photos','order'].includes(parts[2]))throw new Error('条件集合按规则更新，请编辑条件');
      if(body.query!==undefined&&a.type!=='rule')throw new Error('普通影集和语义影集不能改为条件集合');
      const query=body.query===undefined?undefined:normalizePhotoQuery(body.query);
      if(body.name!==undefined&&!String(body.name||'').trim())throw new Error('Enter an album name.');
      await commit(v=>{const item=required(v.albums,a.id);
        if(parts[2]==='photos')replaceMembers(item,method==='POST'?[...item.photo_ids,...body.photo_ids]:body.photo_ids,now());
        if(parts[2]==='order'){const index=captures(v.photos),members=new Set(item.photo_ids),rank=new Map<string,number>();for(const id of [...new Set<string>(body.photo_ids||[])]){for(const member of index.idsForGroups([id]))if(members.has(member)&&!rank.has(member))rank.set(member,rank.size);}item.photo_ids=[...item.photo_ids].sort((a,b)=>(rank.get(a)??item.photo_ids.length)-(rank.get(b)??item.photo_ids.length));}
        item.updated_at=now();if(query!==undefined)item.query=query;if(body.name!==undefined)item.name=String(body.name).trim().slice(0,120);
        const cover=body.cover_photo_id!==undefined?body.cover_photo_id:body.cover_id;
        if(cover!==undefined){if(cover&&!v.photos.some(p=>p.id===cover))throw new Error('封面照片不存在');item.cover_id=cover||null;item.cover_mode=cover?'manual':'auto';}
      });return album(required(current().albums,a.id));
    }return album(a);
  }
  if(parts[0]==='timeline'){
    const all=filtered(q),mode=q.has('scope')?normalizeQueryScope(q.get('scope')).mode:q.get('count_mode')||s.settings.count_mode;
    if(parts[1]==='heatmap'){
      const prefix=timelinePrefix([parts[2]])+'-',result:Record<string,number>={};for(const p of all){const day=cameraDay(p.date_taken);if(day?.startsWith(prefix))result[day]=(result[day]||0)+1;}return result;
    }
    if(parts[1]){
      const unknown=parts[1]==='unknown';if(unknown&&parts.length!==2)throw new Error('Invalid timeline date.');
      const prefix=unknown?'':timelinePrefix(parts.slice(1)),page=Number(q.get('page')||1),size=Number(q.get('page_size')||80);
      if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>200)throw new Error('Invalid pagination.');
      const list=all.filter(p=>unknown?!cameraDay(p.date_taken):cameraDay(p.date_taken)?.startsWith(prefix)).sort(photoOrder('date_taken','desc'));
      return {photos:await Promise.all(list.slice((page-1)*size,page*size).map(hydrate)),total:list.length,count_mode:mode,page,page_size:size};
    }
    const years:Record<string,any>={};let unknown=0;
    for(const p of all){const date=cameraDay(p.date_taken);if(!date){unknown++;continue;}const [year,month,day]=date.split('-');const y=years[year]??={months:{},total:0},m=y.months[month]??={days:{},total:0};m.days[day]=(m.days[day]||0)+1;m.total++;y.total++;}
    return {years,unknown_date:unknown,total:all.length,count_mode:mode};
  }
  if(parts[0]==='stats')return statistics(filtered(q),q.get('mode')||'grouped');
  if(parts[0]==='reports'){
    if(parts[1]==='lenses'){
      const name=decodeURIComponent(parts[2]),scope=refineAnalysis(Object.fromEntries(q),{lens_model:name});
      return lensLifecycle(filtered(new URLSearchParams(scope)),name);
    }
    const result=report(filtered(q),Number(parts[2]),parts[1]==='monthly'?Number(parts[3]):null,s.settings.focal_bands);
    result.filters=analysisPeriod(Object.fromEntries(q),result.filters.date_from,result.filters.date_to);
    for(const mode of ['file','capture'] as const)result.summary[mode==='file'?'files':'captures']=filtered(new URLSearchParams(analysisCounting(result.filters,mode)),false).length;
    return result;
  }
  if(parts[0]==='watermark'){
    if(parts[1]==='drafts'){
      if(parts[2]==='batch-export'){
        if(!Array.isArray(body.draft_ids)||!body.draft_ids.length||body.draft_ids.length>1000)throw new Error('Invalid work selection.');
        const options=structuredClone(body),drafts=[...new Set<string>(body.draft_ids)].map(id=>structuredClone(required(s.drafts,id)));
        return launchTask('export',async context=>{const j=context.job;j.total=drafts.length;await context.checkpoint(true);
          for(const [index,d] of drafts.entries()){context.check();j.current=d.name;
            try{j.results.push(await exportDraft(d,options,context,index+1));j.success++;}
            catch(error){context.check();j.failed++;if(j.errors.length<100)j.errors.push(d.name+': '+(error instanceof Error?error.message:String(error)));}
            j.processed++;await context.checkpoint();}
        },drafts.map(d=>d.id));
      }
      if(!parts[2]){if(method==='POST')return saveDraft(body);let list=s.drafts.filter(d=>(!q.get('status')||d.status===q.get('status'))&&(!q.get('photo_id')||d.photo_id===q.get('photo_id'))&&(!q.get('watermark_type')||d.watermark_type===q.get('watermark_type'))&&(!q.get('search')||(d.name+' '+d.source.file_name+' '+d.settings_json.signature).toLowerCase().includes(q.get('search')!.toLowerCase())));const order=q.get('sort')||'updated_desc';list=list.slice().sort((a,b)=>order==='file_name'?a.source.file_name.localeCompare(b.source.file_name):(order==='updated_asc'?1:-1)*a.updated_at.localeCompare(b.updated_at));return {drafts:await Promise.all(paged(list,q).map(draft)),total:list.length,counts:{all:s.drafts.length,draft:s.drafts.filter(d=>d.status==='draft').length,ready:s.drafts.filter(d=>d.status==='ready').length,exported:s.drafts.filter(d=>d.status==='exported').length}};}
      const d=required(s.drafts,parts[2]);if(parts[3]==='export')return exportDraft(d,body);if(parts[3]==='status'){if(!['draft','ready'].includes(body.status))throw new Error('Invalid work status.');await commit(v=>{required(v.drafts,d.id).status=body.status;});return draft(required(current().drafts,d.id));}
      if(parts[3]==='duplicate'){const copy={...structuredClone(d),id:uid(),name:d.name+' (copy)',status:'draft' as const,exported_revision:0,last_exported_at:null,export_path:null,created_at:now()};await commit(v=>v.drafts.push(copy));return draft(copy);}
      if(parts[3]==='relocate')throw new Error('Reconnect the original directory in local library settings.');
      if(method==='PUT')return saveDraft(body,d.id);if(method==='DELETE'){await commit(v=>{v.drafts=v.drafts.filter(x=>x.id!==d.id);});return {ok:true};}return draft(d);
    }
    if(parts[1]==='export'){const p=photo(body.photo_id),o={...initial,...body.options},file=await original(p),session=librarySession();if(await sourceHash(file)!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');const blob=await processImage<Blob>('watermark',{file,photo:p,options:o,preview:false});if(session!==librarySession())throw new Error('Library changed. Reopen the current library.');if(await sourceHash(await original(p))!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');return {...await exported(blob,outputName(p,o,1)),source_sha256:p.file_hash};}
    if(parts[1]==='batch-export'){
      const options:WatermarkOptions={...initial,...structuredClone(body.options)},photos=(body.photo_ids as string[]).map(id=>structuredClone(photo(id))),aliases=structuredClone(s.tool_preferences?.cameraNames?.aliases||[]),personal=structuredClone(s.logos||[]);
      return launchTask('export',async context=>{
        const j=context.job;j.total=photos.length;await context.checkpoint(true);
        const logos=options.template==='frame'&&options.frame_v2?.logo_mode==='auto'?[...await bundledFrameLogos(),...personal]:[];
        for(const p of photos){context.check();j.current=p.file_name;
          try{const currentOptions=structuredClone(options),frame=currentOptions.frame_v2;
            if(currentOptions.template==='frame'&&frame){frame.tokens={...frame.tokens,...frameTokens(p,aliases,frame.tokens.author??''),title:frame.tokens.title??''};if(frame.logo_mode==='auto')frame.logo=automaticLogo(p,logos);}
            const file=await context.original(p);if(await sourceHash(file)!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');context.check();
            const blob=await processImage<Blob>('watermark',{file,photo:p,options:currentOptions,preview:false},context.signal);
            if(await sourceHash(await context.original(p))!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');context.check();
            j.results.push({...await exported(blob,outputName(p,currentOptions,j.processed+1),context),source_sha256:p.file_hash});j.success++;
          }catch(error){context.check();j.failed++;if(j.errors.length<100)j.errors.push(p.file_name+': '+(error instanceof Error?error.message:String(error)));}
          j.processed++;await context.checkpoint();
        }
      },photos.map(p=>p.id));
    }
  }
  if(parts[0]==='art'){
    if(parts[1]==='settings'){if(method==='PUT'){setCloudSettings(body);await commit(v=>{if(body.image_model)v.art.image_model=body.image_model;if(body.title_model)v.art.title_model=body.title_model;});}return {...cloudSettings(),...current().art,exports_dir:'exports'};}
    if(parts[1]==='jobs')return (recentTasks() as Job[]).filter(j=>j.kind.startsWith('watercolor'));
    if(parts[1]==='generate'||parts[1]==='titles'){
      const p=structuredClone(photo(body.photo_id)),title=parts[1]==='titles',options=structuredClone(body),models={...current().art};
      if(!title){if(options.title_confirmed!==true)throw new Error('Confirm the watercolor title before generating.');options.layout=watercolorLayout(options.layout||{});if(!['low','medium','high'].includes(options.quality||'medium')||typeof (options.description||'')!=='string'||(options.description||'').length>1500)throw new Error('Invalid watercolor request.');}
      if(!cloudSettings().configured)throw new Error('Configure your session key and the cloud relay first.');
      return launchTask(title?'watercolor-title':'watercolor',async context=>{
        const j=context.job;j.photo_id=p.id;j.total=1;j.provider='Qwen';j.model=title?models.title_model:models.image_model;await context.checkpoint(true);
        const originalFile=await context.original(p);
        if(await sourceHash(originalFile)!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');
        const input=await processImage<Blob>('clean',{file:originalFile,profile:p.decode_profile,title},context.signal);context.check();
        if(await sourceHash(await context.original(p))!==p.file_hash)throw new Error('The source photo changed. Reopen it before saving.');
        let result;try{result=await cloudRequest(title?'titles':'generate',input,{...options,model:title?models.title_model:models.image_model},context.signal,()=>context.submitted(),async id=>{j.request_id=id;await context.checkpoint(true);});j.request_id=result.request_id||'';await context.outcome('responded');}
        catch(error){if(error instanceof Error&&'request_id' in error&&typeof error.request_id==='string')j.request_id=error.request_id;if(j.billing_state==='submitted')await context.outcome('unknown');throw error;}
        context.check();if(title)j.suggestions=result.suggestions;
        else{
          const id=uid(),w:LocalWork={id,photo_id:p.id,source:{file_name:p.file_name,width:p.width!,height:p.height!,...(p.edit_origin?{edit_origin:structuredClone(p.edit_origin)}:{})},layout:options.layout,generation:{model:models.image_model,seconds:result.seconds||0},width:Math.round(p.width!*Math.min(1,1536/Math.max(p.width!,p.height!))),height:Math.round(p.height!*Math.min(1,1536/Math.max(p.width!,p.height!))),revision:1};
          await context.write(`works/${id}/scene.png`,await processImage<Blob>('scene',{file:result.image,originalSize:[p.width!,p.height!]},context.signal));await savePoster(w,context);await context.commit(v=>v.works.push(w));j.artwork_id=id;
        }
        j.success=1;j.processed=1;
      },[p.id]);
    }
    if(parts[1]==='works'){if(!parts[2])return {works:await Promise.all(paged([...s.works].reverse(),q).map(work)),total:s.works.length};const w=required(s.works,parts[2]);if(parts[3]==='export'){const format=body.format==='jpg'?'jpg':'png',poster=await localFile(`works/${w.id}/poster-${w.revision}.png`);let blob:Blob=poster;if(format==='jpg'){const options={...initial,fields:[],show_brand_logo:false,info_bar_ratio:0,long_edge:0};blob=await processImage('watermark',{file:poster,photo:{},options,preview:false});}return exported(blob,w.source.file_name.replace(/\.[^.]+$/,'')+'_watercolor.'+format);}
      if(parts[3]==='watermark'){const d:LocalDraft={id:uid(),photo_id:null,artwork_id:w.id,source_revision:w.revision,capture_group_id:null,name:w.source.file_name+' watercolor',watermark_type:'frame',template_id:'frame',settings_json:structuredClone(initial),preview_url:null,status:'draft',revision:1,created_at:now(),updated_at:now(),last_exported_at:null,export_path:null,modified_since_export:true,source_missing:false,source:{file_name:w.source.file_name,file_path:'',camera_model:null,lens_model:null,date_taken:null,artwork_poster_hash:await sourceHash(await localFile(`works/${w.id}/poster-${w.revision}.png`))}};d.preview_file=`drafts/${d.id}/preview-1.webp`;await writeFile(d.preview_file,await renderDraft(d));await commit(v=>v.drafts.push(d));return draft(d);}
      if(method==='PUT')return runLibraryLock('photocollection-work:'+current().id+':'+w.id,async()=>{await assertCurrentRevision();const latest=required(current().works,w.id);if(body.revision!==latest.revision)throw new Error('This work changed in another window. Reopen it before editing.');const next={...latest,layout:body.layout as ArtLayout,revision:await nextPosterRevision(latest)};await savePoster(next);await commit(v=>{v.works[v.works.findIndex(x=>x.id===w.id)]=next;});return work(next);});
      if(method==='DELETE'){if(s.drafts.some(d=>d.artwork_id===w.id))throw new Error('This artwork is used by a watermark draft. Remove that draft first.');await commit(v=>{v.works=v.works.filter(x=>x.id!==w.id);});return {ok:true};}return work(w);
    }
  }
  throw new Error('This operation is not available in the browser release.');
}
