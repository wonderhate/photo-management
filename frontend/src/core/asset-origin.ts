import {validateRecipe} from './editing';
import type {EditRecipe} from './editing';
import type {SourceDecodeProfile} from './source-decode-profile';
import {sourceDecodeProfile} from './source-decode-profile';
export type AssetOrigin={version:1;document_id:string;document_revision:number;source_hash:string;recipe:EditRecipe;decode_profile:SourceDecodeProfile};
export function validateAssetOrigin(value:unknown):asserts value is AssetOrigin{
  const v=value as AssetOrigin;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==6||Object.keys(v).some(k=>!['version','document_id','document_revision','source_hash','recipe','decode_profile'].includes(k))||v.version!==1||typeof v.document_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.document_id)||!Number.isSafeInteger(v.document_revision)||v.document_revision<1||typeof v.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(v.source_hash))throw new Error('Invalid derived asset origin.');
  validateRecipe(v.recipe);sourceDecodeProfile(v.decode_profile);
}
