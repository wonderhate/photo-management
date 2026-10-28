export const VISUAL_ENGINE='pc-phash-canvas32-v1';
export type VisualFingerprint={version:1;engine:typeof VISUAL_ENGINE;phash:string;contrast:number;palette:string[]};
export type StoredFingerprint=VisualFingerprint&{photo_id:string;source_hash:string;source_signature:string;preview_hash:string;preview_signature:string};
const dct=Array.from({length:8},(_,k)=>Float64Array.from({length:32},(_,x)=>Math.cos(Math.PI*(x+.5)*k/32)*(k?1:1/Math.SQRT2)));
const hex=(value:number)=>value.toString(16).padStart(2,'0');

/** Receives a bounded 32×32 opaque RGB display sample from the image worker. */
export function visualFingerprint(pixels:Uint8ClampedArray):VisualFingerprint{
  if(pixels.length!==32*32*4)throw new Error('Invalid appearance fingerprint.');
  const gray=new Float64Array(1024),colors=new Map<number,number>();let mean=0;
  for(let i=0;i<1024;i++){
    const r=pixels[i*4],g=pixels[i*4+1],b=pixels[i*4+2];gray[i]=r*.299+g*.587+b*.114;mean+=gray[i];
    const key=(r>>5)*64+(g>>5)*8+(b>>5);colors.set(key,(colors.get(key)||0)+1);
  }
  mean/=1024;let variance=0;for(const value of gray)variance+=(value-mean)**2;
  const row=new Float64Array(8*32),low=new Float64Array(64);
  for(let k=0;k<8;k++)for(let x=0;x<32;x++)for(let y=0;y<32;y++)row[k*32+x]+=dct[k][y]*gray[y*32+x];
  for(let y=0;y<8;y++)for(let k=0;k<8;k++){let value=0;for(let x=0;x<32;x++)value+=row[y*32+x]*dct[k][x];low[y*8+k]=Math.round(value*1e6)/1e6;}
  const sorted=[...low.slice(1)].sort((a,b)=>a-b),median=sorted[31];let bits=0n;
  for(let i=1;i<64;i++)if(low[i]>median)bits|=1n<<BigInt(i);
  const palette=[...colors].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,6).map(([key])=>'#'+hex(Math.floor(key/64)*32+16)+hex(Math.floor(key/8)%8*32+16)+hex(key%8*32+16));
  return {version:1,engine:VISUAL_ENGINE,phash:bits.toString(16).padStart(16,'0'),contrast:Math.sqrt(variance/1024),palette};
}
export function analyzedColor(value:unknown):string{
  if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Invalid analyzed color.');return value.toLowerCase();
}
export function validateFingerprint(value:unknown):asserts value is StoredFingerprint{
  const v=value as StoredFingerprint;
  if(!v||['photo_id','source_hash','preview_hash','source_signature','preview_signature','phash'].some(key=>typeof (v as unknown as Record<string,unknown>)[key]!=='string'))throw new Error('Invalid appearance fingerprint.');
  if(!v||typeof v!=='object'||v.version!==1||v.engine!==VISUAL_ENGINE||!/^\w[\w-]{0,79}$/.test(v.photo_id)||!/^([a-f0-9]{64})$/.test(v.source_hash)||!/^([a-f0-9]{64})$/.test(v.preview_hash)||!/^\d+:\d+$/.test(v.source_signature)||!/^\d+:\d+$/.test(v.preview_signature)||!/^([a-f0-9]{16})$/.test(v.phash)||!Number.isFinite(v.contrast)||v.contrast<0||v.contrast>255||!Array.isArray(v.palette)||v.palette.length<1||v.palette.length>6||v.palette.some(color=>typeof color!=='string'||!/^#[a-f0-9]{6}$/.test(color)))throw new Error('Invalid appearance fingerprint.');
}
const hamming=(a:bigint,b:bigint)=>{let v=a^b,count=0;while(v){v&=v-1n;count++;}return count;};
type Node={value:bigint;ids:string[];children:Map<number,Node>};
export class VisualHashIndex {
  private root?:Node;
  constructor(items:{id:string;phash:string}[]){
    for(const item of [...items].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
      const value=BigInt('0x'+item.phash),next:Node={value,ids:[item.id],children:new Map()};
      if(!this.root){this.root=next;continue;}let node=this.root;
      while(true){const distance=hamming(node.value,value);if(!distance){node.ids.push(item.id);break;}const child=node.children.get(distance);if(child)node=child;else{node.children.set(distance,next);break;}}
    }
  }
  candidates(phash:string,radius=6){
    if(!Number.isInteger(radius)||radius<0||radius>16)throw new Error('Invalid appearance distance.');
    const value=BigInt('0x'+phash),pending=this.root?[this.root]:[],result:{id:string;distance:number}[]=[];
    while(pending.length){const node=pending.pop()!,distance=hamming(value,node.value);if(distance<=radius)for(const id of node.ids)result.push({id,distance});for(const [edge,child] of node.children)if(edge>=distance-radius&&edge<=distance+radius)pending.push(child);}
    return result.sort((a,b)=>a.distance-b.distance||(a.id<b.id?-1:a.id>b.id?1:0));
  }
}
