import type {CollageOutput,CollageOutputSave} from './collage-output';
import type {CollageProject,CollageProjectSave,CollageProjectQuery} from './collage-project';
import type {LutImportResult} from './lut-contract';
import type {LutFolder} from './lut-folders';
import type {EditRecipe} from './editing';
import type {EditSession} from '../browser/edit-session';
import type {Photo} from '../types';
import {IS_BROWSER} from '../runtime';
import type {SourceDecodeProfile} from './source-decode-profile';
import type {EncodedSplit} from './split-render';
import type {SplitEditSource} from './edit-lineage';
import type {LutAsset} from './lut-contract';

export type EditRecord={id:string;photo_id:string|null;source_name:string;source_hash:string;recipe:EditRecipe;updated_at:string;revision?:number;source_url?:string;source_path?:string;decode_profile?:SourceDecodeProfile;derived_from?:SplitEditSource};
export type EditVariant={id:string;document_id:string;name:string;preview_url:string;width:number;height:number};
export type EditSplitGroup={id:string;document_id:string;document_revision:number;source_hash:string;spec:EncodedSplit['spec'];plan:EncodedSplit['plan'];recipe:EncodedSplit['recipe'];parent_recipe:EditRecipe;format:'png'|'jpg';quality:number;master:EditVariant;panels:EditVariant[]};
export type EditDestination={page:'watermark'|'watercolor';id:string;kind:'photo'|'draft'};
export type ExportPreferences={export_format:'jpg'|'png'|'webp';export_long_edge:number;export_quality:number};
export type EditPage<T>={items:T[];total:number};
export type SplitOutputFolder={id:string;label:string};
export type SplitExportResult={directory:string;files:{file_name:string;sha256:string;url?:string}[]};
export interface EditorLibrary {
  listCollageOutputs(page?:number):Promise<EditPage<CollageOutput>>;
  getCollageOutput(id:string):Promise<CollageOutput>;
  saveCollageOutput(payload:CollageOutputSave,blob:Blob):Promise<CollageOutput>;
  collageOutputImage(id:string):Promise<Blob>;
  collageOutputSource(record:CollageOutput,sourceId:string,signal?:AbortSignal):Promise<File>;
  removeCollageOutput(id:string):Promise<void>;
  listCollages(page?:number,query?:CollageProjectQuery):Promise<EditPage<CollageProject>>;
  getCollage(id:string):Promise<CollageProject>;
  collageSource(record:CollageProject,sourceId:string,signal?:AbortSignal):Promise<File>;
  saveCollage(payload:CollageProjectSave,files:File[]):Promise<CollageProject>;
  removeCollage(record:CollageProject):Promise<void>;
  listLuts():Promise<LutAsset[]>;
  lutPreviewSource(id:string):Promise<File>;
  listLutFolders():Promise<LutFolder[]>;
  linkLutFolder(id?:string):Promise<LutFolder|null>;
  scanLutFolder(id:string):Promise<LutFolder>;
  removeLutFolder(id:string):Promise<void>;
  importLut(file:File):Promise<LutAsset>;
  importLutDetailed(file:File):Promise<LutImportResult>;
  lutSource(id:string):Promise<File>;
  revealLutSource?(id:string):Promise<void>;
  updateLut(id:string,patch:{favorite?:boolean;hidden?:boolean}):Promise<LutAsset>;
  setLutLibraryHidden(hidden:boolean):Promise<{assets:LutAsset[];changed:number}>;
  noteLutUsed(id:string):Promise<LutAsset>;
  preferences():Promise<ExportPreferences>;
  listRecords(page?:number):Promise<EditPage<EditRecord>>;
  getRecord(id:string):Promise<EditRecord>;
  photo(id:string,signal?:AbortSignal):Promise<{file:File;photo:Photo}>;
  source(record:EditRecord,signal?:AbortSignal):Promise<File>;
  save(file:File,recipe:EditRecipe,photoId:string|null,previous?:EditRecord,profile?:SourceDecodeProfile):Promise<EditRecord>;
  remove(record:EditRecord):Promise<void>;
  listVariants?(page?:number):Promise<EditPage<EditVariant>>;
  watermarkVariant?(id:string):Promise<EditDestination>;
  saveSplit?(record:EditRecord,result:EncodedSplit,name:string,requestId:string):Promise<EditSplitGroup>;
  splitGroup?(id:string):Promise<EditSplitGroup>;
  listSplits?(documentId:string,page?:number):Promise<EditPage<EditSplitGroup>>;
  chooseSplitFolder?():Promise<SplitOutputFolder|null>;
  exportSplit?(groupId:string,folder:SplitOutputFolder|null,subfolder:boolean,requestId:string):Promise<SplitExportResult>;
  createSplitEdit?(groupId:string,panelId:string,requestId:string):Promise<EditRecord>;
}
export interface EditorRender {
  session():EditSession;
  export(blob:Blob,name:string):Promise<{url:string;file_name:string}>;
  send(blob:Blob,name:string,photoId:string|null,record:EditRecord,target:'watermark'|'watercolor'):Promise<EditDestination>;
}
export interface EditorServices {
  library:EditorLibrary;
  render:EditorRender;
  capabilities:{watermark:boolean;watercolor:boolean};
}
let services:Promise<EditorServices>|undefined;
export function editorServices(){return services??=(IS_BROWSER?import('../browser/editor-adapter'):import('../native/editor-adapter')).then(m=>m.createEditorServices());}

export async function sourceHash(file:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');}
