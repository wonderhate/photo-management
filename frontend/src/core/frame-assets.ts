import {cameraDisplayName,cameraKey} from './camera-names';
import type {CameraAlias} from './camera-names';
import type {LogoAsset} from './frame-v2';
import {validateLogo} from './frame-v2';
export type FrameSource={id?:string;file_name?:string;camera_make?:string|null;camera_model?:string|null;lens_model?:string|null;focal_length?:number|null;f_number?:number|null;exposure_time?:string|null;iso?:number|null;date_taken?:string|null};
export function frameTokens(source:FrameSource,aliases:CameraAlias[],author=''){
  return {camera_make:source.camera_make||'',camera_model:cameraDisplayName(source.camera_make,source.camera_model,aliases),raw_camera_model:source.camera_model||'',lens_model:source.lens_model||'',date:(source.date_taken||'').replace('T',' ').slice(0,19),file_name:source.file_name||'',focal:source.focal_length?source.focal_length+'mm':'',aperture:source.f_number?'f/'+source.f_number:'',shutter:source.exposure_time?source.exposure_time+'s':'',iso:source.iso?'ISO '+source.iso:'',author,title:''};
}
export function automaticLogo(source:FrameSource,logos:LogoAsset[]){
  const make=cameraKey(source.camera_make||'');if(!make)return null;
  const personal=[...logos].reverse().find(l=>!l.id.startsWith('bundled-')&&l.make&&cameraKey(l.make)===make);if(personal)return structuredClone(personal);
  const bundled=logos.find(l=>l.id.startsWith('bundled-')&&l.make&&(cameraKey(l.make)===make||make.startsWith(cameraKey(l.make)+' ')));
  return bundled?structuredClone(bundled):null;
}
export async function normalizeLogo(file:Blob,details:Omit<LogoAsset,'data_url'|'width'|'height'|'sha256'>,resize=false):Promise<LogoAsset>{
  if(file.size>10*1024**2)throw new Error('Logo source exceeds 10 MiB.');
  const bitmap=await createImageBitmap(file);
  try{
    if(!resize&&(bitmap.width>2048||bitmap.height>2048))throw new Error('Logo dimensions exceed 2048 pixels. Resize a copy before importing.');
    const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);const png=await canvas.convertToBlob({type:'image/png'});
    const bytes=new Uint8Array(await png.arrayBuffer());if(bytes.length>2_200_000)throw new Error('Logo PNG exceeds the 2.2 MB storage limit.');
    let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    const asset={...details,width:canvas.width,height:canvas.height,data_url:'data:image/png;base64,'+btoa(binary),sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')};validateLogo(asset);return asset;
  }finally{bitmap.close();}
}
const sources:Record<string,string>={nikon:'https://www.nikon.com/company/corporate/brand/brand_symbol/img/logo.svg',canon:'https://global.canon/01cmn/img/common/logo.svg',fujifilm:'https://holdings.fujifilm.com/themes/custom/fujifilm_com_g2/common/img/fujifilm_corporate_logo.svg',leica:'https://leica-camera.com/themes/custom/leica_redesign_theme/logo.svg',sony:'https://www.sony.jp/header-footer/assets/img/GlobalHeader/logo.svg'};
let bundled:Promise<LogoAsset[]>|undefined;
export function bundledFrameLogos(){return bundled??=Promise.all(Object.entries(sources).map(async([make,source])=>{
  const response=await fetch('/local-assets/brand_logos/'+make+'.png');if(!response.ok)throw new Error('Camera logo asset is unavailable.');return normalizeLogo(await response.blob(),{id:'bundled-'+make,name:make.toUpperCase(),make,variant:'both',source,license:'Manufacturer trademark. Existing PhotoCollection asset; see brand_logos/sources.json.'});
})).then(async values=>{const response=await fetch('/local-assets/signatures/natural.png');if(!response.ok)throw new Error('Signature asset is unavailable.');values.push(await normalizeLogo(await response.blob(),{id:'bundled-natural',name:'wonder',make:'',variant:'both',source:'PhotoCollection bundled natural signature',license:'Original project signature; see assets/signatures/README.md.'},true));return values;}).catch(error=>{bundled=undefined;throw error;});}
