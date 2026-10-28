import {validateCollageProject,collageAssetPath} from './collage-project.ts';
import type {CollageProject,StoredCollageProject} from './collage-project';
import {splitID} from './split-record.ts';
export type CollageOutputSave={id:string;project_id:string;project_revision:number;page:number;format:'png'|'jpg'|'webp';quality:number;sha256:string};
export type CollageOutput={version:1;id:string;project:CollageProject;page:number;format:'png'|'jpg'|'webp';quality:number;sha256:string;width:number;height:number;created_at:string};
export type StoredCollageOutput=CollageOutput&{assets:StoredCollageProject['assets'];storage_id:string};
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export function validateCollageOutputSave(v:CollageOutputSave){if(!exact(v,['id','project_id','project_revision','page','format','quality','sha256'])||!splitID(v.id)||!splitID(v.project_id)||!Number.isSafeInteger(v.project_revision)||v.project_revision<1||!Number.isSafeInteger(v.page)||v.page<0||v.page>=240||!['png','jpg','webp'].includes(v.format)||!Number.isInteger(v.quality)||v.quality<1||v.quality>100||!/^([a-f0-9]{64})$/.test(v.sha256))throw new Error('Invalid collage output.');}
export function collageOutputScene(record:CollageOutput){const d=record.project.document;return d.kind==='single'?record.page===0?d.value:undefined:d.value.pages[record.page];}
export function validateCollageOutput(v:CollageOutput,stored=false){
 if(!exact(v,['version','id','project','page','format','quality','sha256','width','height','created_at',...(stored?['assets','storage_id']:[])])||v.version!==1)throw new Error('Invalid collage output.');
 validateCollageProject(v.project);validateCollageOutputSave({id:v.id,project_id:v.project.id,project_revision:v.project.revision,page:v.page,format:v.format,quality:v.quality,sha256:v.sha256});
 const scene=collageOutputScene(v);if(!scene||v.width!==scene.width||v.height!==scene.height||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at)))throw new Error('Invalid collage output.');
 if(stored){const s=v as StoredCollageOutput;if(!splitID(s.storage_id))throw new Error('Invalid collage output.');validateCollageProject({...s.project,assets:s.assets},true);s.assets.forEach(collageAssetPath);}
}
export function collageOutputPath(v:StoredCollageOutput){validateCollageOutput(v,true);return `drafts/collage-outputs/${v.storage_id}/${v.sha256}.${v.format}`;}
export function collageOutputName(v:CollageOutput){return 'Collage-'+v.id+'-'+(v.page+1)+'.'+v.format;}
export const collageOutputMime=(format:CollageOutput['format'])=>format==='jpg'?'image/jpeg':'image/'+format;
