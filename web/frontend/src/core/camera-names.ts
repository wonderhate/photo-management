import cameraNames from './camera-name-map.json' with {type:'json'};
// Small exact-match table; never infer a model from an ambiguous prefix.
// Selected mappings from AfterFrame camera-names/manual.json, MIT,
// commit 26e19935469e696133088b798f23b5b3654d910f. See public/licenses/AfterFrame-MIT.txt.
export type CameraAlias={make:string;model:string;name:string};
export type CameraNamePreferences={aliases:CameraAlias[]};
export const CAMERA_NAMES_VERSION=1;
export const cameraKey=(value:string)=>value.replace(/\s+/g,' ').trim().toLowerCase();
export const sameCamera=(a:Pick<CameraAlias,'make'|'model'>,b:Pick<CameraAlias,'make'|'model'>)=>cameraKey(a.make)===cameraKey(b.make)&&cameraKey(a.model)===cameraKey(b.model);
const names:Record<string,Record<string,string>>=cameraNames;
export function validCameraAliases(value:unknown):value is CameraAlias[]{
  if(!Array.isArray(value)||value.length>500)return false;
  const seen=new Set<string>();
  return value.every(v=>{
    if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==3||!['make','model','name'].every(k=>Object.hasOwn(v,k)&&typeof v[k]==='string'&&v[k].length<=(k==='name'?80:200)&&!/[\u0000-\u001f\u007f]/.test(v[k]))||!v.model.trim()||!v.name.trim())return false;
    const key=JSON.stringify([cameraKey(v.make),cameraKey(v.model)]);
    if(seen.has(key))return false;seen.add(key);return true;
  });
}
export function cameraDisplayName(make:string|null|undefined,model:string|null|undefined,aliases:CameraAlias[]=[]){
  const raw={make:make||'',model:model||''};
  const override=aliases.find(a=>sameCamera(a,raw));
  if(override)return override.name;
  const makeKey=cameraKey(raw.make),brand=Object.hasOwn(names,makeKey)?names[makeKey]:undefined,key=cameraKey(raw.model);
  return brand&&Object.hasOwn(brand,key)?brand[key]:raw.model||raw.make;
}
export function parseCameraNameFile(text:string):CameraAlias[]{
  if(text.length>300000)throw new Error('Invalid camera name mappings.');
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['version','aliases'].includes(k))||value.version!==1||!validCameraAliases(value.aliases))throw new Error('Invalid camera name mappings.');
  return value.aliases;
}
