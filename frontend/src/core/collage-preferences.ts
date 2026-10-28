import type {CollageScene} from './collage.ts';
export type CollageCanvas=Pick<CollageScene,'width'|'height'|'gap'|'padding'|'radius'|'background'>&{edge_blend:number};
export type CollagePreferences={canvas:CollageCanvas;format:'png'|'jpg'|'webp';quality:number;showGuides:boolean};
export type CollageBatchPreferences={size:2|3|4|6|9;order:'selection'|'filename'|'capture_time';remainder:'own'|'merge'|'drop';format:'png'|'jpg'|'webp';quality:number};
export const collageDefaults:CollagePreferences={canvas:{width:2400,height:2400,gap:.008,padding:.02,radius:0,background:'#f7f3eb',edge_blend:0},format:'png',quality:95,showGuides:true};
export const collageBatchDefaults:CollageBatchPreferences={size:4,order:'selection',remainder:'own',format:'png',quality:95};
export function validCollagePreference(key:string,value:unknown,batch=false):boolean{
 if(key==='format')return ['png','jpg','webp'].includes(value as string);
 if(key==='quality')return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=100;
 if(batch)return key==='size'?typeof value==='number'&&[2,3,4,6,9].includes(value):key==='order'?['selection','filename','capture_time'].includes(value as string):key==='remainder'&&['own','merge','drop'].includes(value as string);
 if(key==='showGuides')return typeof value==='boolean';
 if(key!=='canvas'||!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as CollageCanvas,keys=Object.keys(collageDefaults.canvas);if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))return false;
 return ['width','height'].every(k=>{const n=v[k as 'width'];return Number.isInteger(n)&&n>=100&&n<=12000;})&&v.width*v.height<=100000000&&['gap','padding','radius','edge_blend'].every(k=>{const n=v[k as 'gap'];return typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=(k==='gap'?.08:k==='edge_blend'?10000:.2);})&&typeof v.background==='string'&&/^#[a-f0-9]{6}$/i.test(v.background);
}
