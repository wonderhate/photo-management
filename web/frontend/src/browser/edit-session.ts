import type {TextRenderResult} from './text-render';
import type {ColorStats,EditRecipe,analyzePixels} from './editing';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import type {SourceDecodeProfile} from '../core/source-decode-profile';
import type {SplitSpec} from '../core/seamless-split';
import type {EncodedSplit,SplitProgress} from '../core/split-render';
import {recipeLayers} from '../core/layer-recipe';
import {layerAssetHashes} from '../core/layer-stack';
import {visionAssets} from '../core/vision-service';
export type Analysis=ReturnType<typeof analyzePixels>;
export type OpenedImage={width:number;height:number;bits:number;metadata:Record<string,unknown>;original:Blob;analysis:Analysis};
export type RenderedImage={blob:Blob;width:number;height:number;analysis:Analysis;textLayouts?:TextRenderResult};
export class EditSession{
  private worker=new Worker(new URL('./edit-worker.ts',import.meta.url),{type:'module'});
  private sequence=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;progress?:(value:SplitProgress)=>void}>();
  private tail:Promise<unknown>=Promise.resolve();
  private closed=false;
  private lutCache:{id:string;file:Promise<File>}|null=null;
  private layerAssets=new Map<string,Promise<Blob>>();
  private layerBytes=new Map<string,number>();
  private loadLut?:((id:string)=>Promise<File>);
  constructor(loadLut?:(id:string)=>Promise<File>){this.loadLut=loadLut;this.worker.onmessage=({data})=>{const pending=this.pending.get(data.id);if(!pending)return;if(data.progress){pending.progress?.(data.progress);return;}clearTimeout(pending.timer);this.pending.delete(data.id);if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.result);};this.worker.onerror=()=>this.dispose('Image worker failed. Reopen the photo.');this.worker.onmessageerror=()=>this.dispose('Image worker failed. Reopen the photo.');}
  private request<T>(action:string,payload:object,progress?:(value:SplitProgress)=>void):Promise<T>{
    const run=async()=>{
      if(this.closed)throw new Error('Image operation cancelled.');
      const requestRecipe=payload as {recipe?:EditRecipe;textRecipe?:EditRecipe},recipe=requestRecipe.textRecipe??requestRecipe.recipe;let lut: {id:string;file:File}|undefined;
      if(recipe?.version===5&&recipe.lut){
        const id=recipe.lut.asset_hash;if(!this.loadLut)throw new Error('LUT source is unavailable. Reopen the editor.');
        if(this.lutCache?.id!==id){const file=this.loadLut(id);this.lutCache={id,file};void file.catch(()=>{if(this.lutCache?.file===file)this.lutCache=null;});}
        lut={id,file:await this.lutCache.file};
      }
      const hashes=recipe?layerAssetHashes(recipeLayers(recipe)):[],layerAssets:{id:string;file:Blob}[]=[];
      for(const id of this.layerAssets.keys())if(!hashes.includes(id)){this.layerAssets.delete(id);this.layerBytes.delete(id);}
      if(hashes.length){const assets=await visionAssets();for(const id of hashes){let pending=this.layerAssets.get(id);if(!pending){pending=assets.source(id);this.layerAssets.set(id,pending);void pending.then(file=>{if(this.layerAssets.get(id)===pending){this.layerBytes.set(id,file.size);if([...this.layerBytes.values()].reduce((n,b)=>n+b,0)>128*1024*1024){this.layerAssets.delete(id);this.layerBytes.delete(id);}}},()=>{if(this.layerAssets.get(id)===pending){this.layerAssets.delete(id);this.layerBytes.delete(id);}});}layerAssets.push({id,file:await pending});}}
      return new Promise<T>((resolve,reject)=>{if(this.closed){reject(new Error('Image operation cancelled.'));return;}const id=++this.sequence,timer=setTimeout(()=>this.dispose('Image processing timed out. Try a smaller photo.'),180000);this.pending.set(id,{resolve,reject,timer,progress});this.worker.postMessage({id,action,...payload,layerAssets,...(lut?{lut}:{})});});
    };const result=this.tail.then(run,run);this.tail=result.catch(()=>{});return result;
  }
  open(file:File,profile?:SourceDecodeProfile){return this.request<OpenedImage>('open',{file,profile:sourceDecodeProfile(profile)});}
  reference(file:File,profile?:SourceDecodeProfile){return this.request<{stats:ColorStats;preview:Blob}>('reference',{file,profile:sourceDecodeProfile(profile)});}
  render(recipe:EditRecipe,textRecipe?:EditRecipe){return this.request<RenderedImage>('render',structuredClone({recipe,textRecipe}));}
  export(recipe:EditRecipe,edge:number,format:string,quality:number){return this.request<RenderedImage>('export',structuredClone({recipe,edge,format,quality}));}
  split(recipe:EditRecipe,spec:SplitSpec,format:'png'|'jpg',quality:number,progress?:(value:SplitProgress)=>void){return this.request<EncodedSplit>('split',structuredClone({recipe,spec,format,quality}),progress);}
  display(file:File,edge:4096|6144,background:'white'|'black',orientation=1){return this.request<{blob:Blob;width:number;height:number;bits:number}>('display',{file,edge,background,orientation});}
  dispose(message='Image operation cancelled.'){if(this.closed)return;this.closed=true;this.worker.terminate();this.lutCache=null;this.layerAssets.clear();this.layerBytes.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear();}
}
