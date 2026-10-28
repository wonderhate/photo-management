import {editorServices,sourceHash} from '../core/editor-adapter';
import {neutralRecipe,validateRecipeSource} from '../core/editing';
import type {EditRecipe} from '../core/editing';
import {withLayerStack} from '../core/layer-recipe';
import {upgradeLayerDocument} from '../core/layer-geometry';
import {newTextLayer} from '../core/text-layers';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {newSourceDecodeProfile} from '../browser/source-profile';
import {CollageSession} from '../browser/collage-session';
import {collageDocumentSources} from '../core/collage-project';
import type {AgentReview,AgentResult} from '../core/agent';

export async function renderAgent(review:AgentReview,signal:AbortSignal,progress:(done:number,total:number,result:AgentResult)=>void):Promise<AgentResult>{
 const {library,render}=await editorServices(),a=review.arguments;
 const result:AgentResult={documents:[],exports:[]};signal.throwIfAborted();
 if(review.tool==='render_collage'){
  const project=await library.getCollage(String(a.project_id));if(project.revision!==a.revision)throw new Error('Collage changed. Review the request again.');
  const session=new CollageSession(),cancel=()=>session.close();signal.addEventListener('abort',cancel,{once:true});
  try{
   const inputs=[];for(const source of collageDocumentSources(project.document)){signal.throwIfAborted();inputs.push({id:source.id,file:await library.collageSource(project,source.id,signal),profile:source.profile});}
   await session.open(inputs);signal.throwIfAborted();
   const scenes=project.document.kind==='single'?[project.document.value]:project.document.value.pages;
   for(let index=0;index<scenes.length;index++){
    signal.throwIfAborted();const scene=scenes[index];
    const output=await session.export(scene,{format:a.format||'png',quality:Number(a.quality||90),edge:Number(a.long_edge||4096)});signal.throwIfAborted();
    result.exports!.push(await render.export(output.blob,`Collage-${project.id}-${index+1}.${a.format||'png'}`));progress(index+1,scenes.length,structuredClone(result));
   }
   return result;
  }finally{signal.removeEventListener('abort',cancel);session.close();}
 }
 const ids=a.photo_ids||[];
 for(let n=0;n<ids.length;n++){
  signal.throwIfAborted();const expected=review.snapshot.photos.find(p=>p.id===ids[n]);if(!expected)throw new Error('Invalid Agent photo scope.');
  const {file,photo}=await library.photo(ids[n],signal);if(await sourceHash(file)!==expected.hash)throw new Error('The source photo changed. Reopen it before saving.');
  const session=render.session(),cancel=()=>session.dispose();signal.addEventListener('abort',cancel,{once:true});
  try{
   const profile=photo.decode_profile?sourceDecodeProfile(photo.decode_profile):await newSourceDecodeProfile(file),opened=await session.open(file,profile);signal.throwIfAborted();
   let recipe:EditRecipe=neutralRecipe();
   if(review.tool==='edit_asset')recipe=structuredClone(a.recipe) as EditRecipe;
   if(review.tool==='crop_assets')recipe={...recipe,crop:{x:Number(a.x),y:Number(a.y),width:Number(a.width),height:Number(a.height)}};
   if(review.tool==='add_text'){
    const layer={...newTextLayer("text-"+crypto.randomUUID(),String(a.text)),x:Number(a.x),y:Number(a.y),size:Number(a.size),fill:{kind:'solid' as const,color:String(a.color),opacity:1}};
    recipe=withLayerStack(recipe,opened,upgradeLayerDocument({version:1,layers:[layer]},recipe,opened));
   }
   validateRecipeSource(recipe,opened);signal.throwIfAborted();
   if(review.tool==='export_assets'){
    const output=await session.export(recipe,Number(a.long_edge),a.format||'jpg',Number(a.quality));signal.throwIfAborted();
    result.exports!.push(await render.export(output.blob,photo.file_name.replace(/\.[^.]+$/,'')+'-agent.'+(a.format||'jpg')));
   }else{
    const saved=await library.save(file,recipe,photo.id,undefined,profile);result.documents!.push({id:saved.id,photo_id:photo.id});
   }
   progress(n+1,ids.length,structuredClone(result));
  }finally{signal.removeEventListener('abort',cancel);session.dispose();}
 }
 return result;
}
