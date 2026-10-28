import type {LutAsset} from './lut-contract.ts';
import type {LutFolder} from './lut-folders.ts';
export const LUT_IMPORT_LIMIT=5000;
export function copiedLuts(assets:LutAsset[],folders:LutFolder[]){const external=new Set(folders.flatMap(f=>f.entries.map(e=>e.asset?.id)));return assets.filter(a=>a.version===2||!external.has(a.id));}
export function inLutGroup(asset:LutAsset,path:string){const group=asset.context?.groups.join('/')||'';return !path||group===path||group.startsWith(path+'/');}
