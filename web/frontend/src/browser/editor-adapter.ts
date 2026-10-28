import {mutationMethod} from './maintenance';
import {listCollageOutputs,getCollageOutput,saveCollageOutput,collageOutputImage,collageOutputSource,removeCollageOutput} from './collage-output-storage';
import {listCollages,getCollage,collageSource,saveCollage,removeCollage} from './collage-storage';
import {listLutFolders,linkLutFolder,scanLutFolder,removeLutFolder} from './lut-folders';
import {setLutLibraryHidden,listLuts,importLut,importLutDetailed,lutSource,lutPreviewSource,ensureLutAsset,updateLut,noteLutUsed} from './lut-storage';
import {api} from '../api';
import type {Photo} from '../types';
import type {EditorServices,EditRecord} from '../core/editor-adapter';
import {EditSession} from './edit-session';
import {current,original,commit,allPhotoSources} from './storage';
import {saveEdit,editSource,saveDerivative,getEditRecord} from './edit-storage';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {saveSplit,splitGroup,listSplits} from './split-storage';
import {chooseSplitFolder,exportSplit} from './split-export';
import {createSplitEdit} from './split-edit';

export function createEditorServices():EditorServices{
  const services:EditorServices={
    capabilities:{watermark:true,watercolor:true},
    library:{
      listCollageOutputs,getCollageOutput,saveCollageOutput,collageOutputImage,collageOutputSource,removeCollageOutput,
      listCollages,getCollage,collageSource,saveCollage,removeCollage,
      setLutLibraryHidden,listLuts,importLut,importLutDetailed,lutSource,lutPreviewSource,updateLut,noteLutUsed,listLutFolders,linkLutFolder,scanLutFolder,removeLutFolder,
      saveSplit,splitGroup,listSplits,createSplitEdit,
      getRecord:getEditRecord,
      chooseSplitFolder,exportSplit,
      preferences:async()=>({...current().settings}),
      listRecords:async(page=1)=>{const items=current().edits||[];return {items:items.slice((page-1)*20,page*20),total:items.length};},
      async photo(id,signal){
        signal?.throwIfAborted();const photo=await api<Photo>('/photos/'+id,undefined,undefined,signal);
        const stored=current().photos.find(p=>p.id===id);if(!stored)throw new Error('Record not found.');
        const file=await original(stored);signal?.throwIfAborted();return {photo:{...photo,decode_profile:sourceDecodeProfile(stored.decode_profile)},file:new File([file],photo.file_name,{type:file.type})};
      },
      async source(record,signal){signal?.throwIfAborted();const file=await editSource(record);signal?.throwIfAborted();return file;},
      save:async(file,recipe,id,previous,profile)=>{if(recipe.version===5&&recipe.lut)await ensureLutAsset(recipe.lut.asset_hash);return saveEdit(file,recipe,id,previous?.id,profile,previous?(previous.revision??0):undefined);},
      remove:async(record:EditRecord)=>{await commit(s=>{if(s.splits?.some(g=>g.document_id===record.id))throw new Error('This edit is used by a split group.');if([...allPhotoSources(s).flatMap(p=>[p.edit_origin,p.asset_origin]),...s.drafts.map(d=>d.source?.edit_origin),...s.works.map(w=>w.source?.edit_origin)].some(o=>o?.document_id===record.id))throw new Error('This edit is used by a saved output.');s.edits=(s.edits||[]).filter(e=>e.id!==record.id);});}
    },
    render:{
      session:()=>new EditSession(lutSource),
      export:async(blob,name)=>(await import('./api')).exported(blob,name),
      async send(blob,name,photoId,_record,target){const photo=await saveDerivative(blob,name,photoId,_record);return {page:target,id:photo.id,kind:'photo'};}
    }
  };
  return {...services,library:{...services.library,
    save:mutationMethod(services.library.save),remove:mutationMethod(services.library.remove),
    saveSplit:mutationMethod(saveSplit),createSplitEdit:mutationMethod(createSplitEdit),
    saveCollage:mutationMethod(services.library.saveCollage),removeCollage:mutationMethod(services.library.removeCollage),
    saveCollageOutput:mutationMethod(services.library.saveCollageOutput),removeCollageOutput:mutationMethod(services.library.removeCollageOutput),
    importLut:mutationMethod(importLut),importLutDetailed:mutationMethod(importLutDetailed),
    linkLutFolder:mutationMethod(linkLutFolder),scanLutFolder:mutationMethod(scanLutFolder),removeLutFolder:mutationMethod(removeLutFolder),
    updateLut:mutationMethod(updateLut),noteLutUsed:mutationMethod(noteLutUsed),setLutLibraryHidden:mutationMethod(setLutLibraryHidden),
    exportSplit:mutationMethod(exportSplit),
  },render:{...services.render,send:mutationMethod(services.render.send),export:mutationMethod(services.render.export)}};
}
