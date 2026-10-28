import {validateCollageOutput,validateCollageOutputSave,collageOutputMime} from '../core/collage-output';
import type {CollageOutput} from '../core/collage-output';
import type {CollageProject} from '../core/collage-project';
import {collageDocumentSources,validateCollageSave,validateCollageProject} from '../core/collage-project';
import {lutImportGroups} from '../core/lut-context';
import type {LutFolder} from '../core/lut-folders';
import type {LutAsset,LutImportResult} from '../core/lut-contract';
import {MAX_CUBE_BYTES} from '../core/cube-lut';
import {sourceBlob} from '../core/source-stream';
import {api,nativeFetch,scopeNativeResult} from '../api';
import type {Photo} from '../types';
import type {EditorServices,EditRecord,EditVariant,EditSplitGroup,ExportPreferences,SplitExportResult} from '../core/editor-adapter';
import {sourceHash} from '../core/editor-adapter';
import {EditSession} from '../browser/edit-session';
import {validateRecipe} from '../core/editing';
import {sourceDecodeProfile} from '../core/source-decode-profile';

async function checked(response:Response){
  if(!response.ok){const error=await response.json().catch(()=>({detail:'请求失败'}));throw new Error(typeof error.detail==='string'?error.detail:'Invalid editor response.');}
  return response;
}
async function upload<T>(path:string,file:Blob,payload?:unknown,name?:string):Promise<T>{
  const body=new FormData();body.append('file',file,file instanceof File?file.name:'render');
  if(payload!==undefined)body.append('payload',JSON.stringify(payload));if(name!==undefined)body.append('name',name);
  return scopeNativeResult(await(await checked(await nativeFetch('/api/editor'+path,{method:'POST',body}))).json());
}
async function records<T>(path:string,key:string,page=1){
  const result=await api<Record<string,unknown>>('/editor/'+path+'?page_size=20&page='+page);
  return {items:result[key] as T[],total:Number(result.total)};
}
export function createEditorServices():EditorServices{
  async function lutSource(id:string,preview=false){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid LUT data.');const response=await checked(await nativeFetch('/api/editor/luts/'+id+(preview?'/preview-source':'/source')));const blob=await response.blob();if(blob.size>MAX_CUBE_BYTES||await sourceHash(blob)!==id)throw new Error('LUT source changed. Restore a backup.');return new File([blob],id+'.cube');}

  async function watermarkVariant(id:string){const draft=await api<{id:string}>('/editor/variants/'+id+'/watermark','POST');return {page:'watermark' as const,id:draft.id,kind:'draft' as const};}
  return {
    capabilities:{watermark:true,watercolor:false},
    library:{
      listCollageOutputs:(page=1)=>api('/editor/collage-outputs?page='+page),
      async getCollageOutput(id){const v=await api<CollageOutput>('/editor/collage-outputs/'+encodeURIComponent(id));validateCollageOutput(v);return v;},
      async saveCollageOutput(payload,blob){validateCollageOutputSave(payload);const v=await upload<CollageOutput>('/collage-outputs',blob,payload);validateCollageOutput(v);return v;},
      async collageOutputImage(id){const v=await api<CollageOutput>('/editor/collage-outputs/'+encodeURIComponent(id)),response=await checked(await nativeFetch('/api/editor/collage-outputs/'+encodeURIComponent(id)+'/image')),blob=await sourceBlob(response);if(await sourceHash(blob)!==v.sha256)throw new Error('Collage output is missing or changed. Restore a backup.');return new Blob([blob],{type:collageOutputMime(v.format)});},
      async collageOutputSource(record,sourceId,signal){const source=collageDocumentSources(record.project.document).find(s=>s.id===sourceId);if(!source)throw new Error('Invalid collage output.');const response=await checked(await nativeFetch('/api/editor/collage-outputs/'+encodeURIComponent(record.id)+'/sources/'+encodeURIComponent(sourceId),{signal})),blob=await sourceBlob(response,signal);if(await sourceHash(blob)!==source.sha256)throw new Error('Collage output is missing or changed. Restore a backup.');signal?.throwIfAborted();return new File([blob],source.name,{type:blob.type});},
      async removeCollageOutput(id){await api('/editor/collage-outputs/'+encodeURIComponent(id),'DELETE');},
      listCollages:(page=1,options={})=>api('/editor/collages?'+new URLSearchParams({page:String(page),...options})),
      async getCollage(id){const record=await api<CollageProject>('/editor/collages/'+encodeURIComponent(id));validateCollageProject(record);return record;},
      async collageSource(record,sourceId,signal){const source=collageDocumentSources(record.document).find(s=>s.id===sourceId);if(!source)throw new Error('Invalid collage project.');const response=await checked(await nativeFetch('/api/editor/collages/'+encodeURIComponent(record.id)+'/sources/'+encodeURIComponent(sourceId)+'?revision='+record.revision,{signal}));const blob=await sourceBlob(response,signal);if(await sourceHash(blob)!==source.sha256)throw new Error('Collage project sources are missing or changed. Restore a backup.');signal?.throwIfAborted();return new File([blob],source.name,{type:blob.type});},
      async saveCollage(payload,files){validateCollageSave(payload);const body=new FormData();body.append('payload',JSON.stringify(payload));for(const file of files)body.append('files',file,file.name);const record=scopeNativeResult(await(await checked(await nativeFetch('/api/editor/collages',{method:'POST',body}))).json());validateCollageProject(record);return record;},
      async removeCollage(record){await api('/editor/collages/'+encodeURIComponent(record.id)+'?revision='+record.revision,'DELETE');},
      listLuts:()=>api<LutAsset[]>('/editor/luts'),
      async revealLutSource(id){await api('/editor/luts/'+encodeURIComponent(id)+'/reveal','POST');},
      lutPreviewSource:id=>lutSource(id,true),
      listLutFolders:()=>api<LutFolder[]>('/editor/luts/folders'),
      async linkLutFolder(id){const result=await api<{paths:string[]}>('/dialog/lut-directory','POST');return result.paths[0]?api<LutFolder>('/editor/luts/folders','POST',{path:result.paths[0],...(id?{id}:{})}):null;},
      scanLutFolder:id=>api<LutFolder>('/editor/luts/folders/'+encodeURIComponent(id)+'/scan','POST'),
      async removeLutFolder(id){await api('/editor/luts/folders/'+encodeURIComponent(id),'DELETE');},
      importLut:file=>upload<LutAsset>('/luts',file,{groups:lutImportGroups(file)}),
      importLutDetailed:file=>upload<LutImportResult>('/luts?detailed=true',file,{groups:lutImportGroups(file)}),lutSource,
      updateLut:(id,patch)=>api<LutAsset>('/editor/luts/'+encodeURIComponent(id),'PATCH',patch),
      setLutLibraryHidden:hidden=>api('/editor/luts/library/visibility','POST',{hidden}),
      noteLutUsed:id=>api<LutAsset>('/editor/luts/'+encodeURIComponent(id)+'/used','POST'),

      preferences:()=>api<ExportPreferences>('/settings'),
      listRecords:page=>records<EditRecord>('edits','edits',page),
      getRecord:id=>api<EditRecord>('/editor/edits/'+encodeURIComponent(id)),
      createSplitEdit:(groupId,panelId,requestId)=>api<EditRecord>('/editor/splits/'+encodeURIComponent(groupId)+'/panels/'+encodeURIComponent(panelId)+'/edit','POST',{request_id:requestId}),
      listVariants:page=>records<EditVariant>('variants','variants',page),
      watermarkVariant,
      splitGroup:id=>api<EditSplitGroup>('/editor/splits/'+encodeURIComponent(id)),
      listSplits:(documentId,page=1)=>api('/editor/splits?document_id='+encodeURIComponent(documentId)+'&page_size=20&page='+page),
      async chooseSplitFolder(){const result=await api<{paths:string[]}>('/dialog/directory','POST');return result.paths[0]?{id:result.paths[0],label:result.paths[0]}:null;},
      exportSplit:(groupId,folder,subfolder,requestId)=>api<SplitExportResult>('/editor/splits/'+encodeURIComponent(groupId)+'/export','POST',{request_id:requestId,output_directory:folder?.id??null,subfolder}),
      async saveSplit(record,result,name,requestId){
        const body=new FormData();body.append('payload',JSON.stringify({request_id:requestId,document_id:record.id,document_revision:record.revision,
          source_hash:record.source_hash,name,expected_recipe:result.parent_recipe,spec:result.spec,format:result.format,quality:result.quality,master_hash:result.master.sha256,panel_hashes:result.panels.map(p=>p.sha256)}));
        body.append('file',result.master.blob,'master.png');for(const panel of result.panels)body.append('panels',panel.blob,`panel-${panel.index}.${result.format}`);
        return scopeNativeResult(await(await checked(await nativeFetch('/api/editor/splits',{method:'POST',body}))).json());
      },
      async photo(id,signal){
        const photo=await api<Photo>('/photos/'+id,undefined,undefined,signal);
        const response=await checked(await nativeFetch('/api/photos/'+encodeURIComponent(id)+'/original',{signal}));
        const blob=await sourceBlob(response,signal);signal?.throwIfAborted();return {photo,file:new File([blob],photo.file_name,{type:blob.type})};
      },
      async source(record,signal){
        const response=await checked(await nativeFetch('/api/editor/edits/'+encodeURIComponent(record.id)+'/source',{signal}));
        const file=new File([await sourceBlob(response,signal)],record.source_name);signal?.throwIfAborted();
        if(await sourceHash(file)!==record.source_hash)throw new Error('The source photo changed. Reopen it before saving.');
        return file;
      },
      async save(file,recipe,photoId,previous,profile){
        if(recipe.version===5&&recipe.lut)await api('/editor/luts/'+recipe.lut.asset_hash+'/pin','POST');
        validateRecipe(recipe);const hash=await sourceHash(file),decode_profile=sourceDecodeProfile(profile??previous?.decode_profile);
        if(previous&&JSON.stringify(sourceDecodeProfile(previous.decode_profile))!==JSON.stringify(decode_profile))throw new Error('源文件解码规则不可更改，请重新打开已保存的工程。');
        if(previous)return api<EditRecord>('/editor/edits/'+previous.id,'PUT',{revision:previous.revision,source_hash:hash,recipe});
        return upload<EditRecord>('/edits',file,{photo_id:photoId,source_name:file.name,source_hash:hash,recipe,decode_profile});
      },
      async remove(record){await api('/editor/edits/'+record.id,'DELETE');}
    },
    render:{
      session:()=>new EditSession(lutSource),
      export:(blob,name)=>upload('/exports',blob,undefined,name),
      async send(blob,name,_photoId,record,target){
        if(target!=='watermark')throw new Error('Edited copies are not supported by this AI service yet.');
        const variant=await upload<EditVariant>('/variants',blob,{document_id:record.id,document_revision:record.revision,name,expected_recipe:record.recipe});
        return watermarkVariant(variant.id);
      }
    }
  };
}
