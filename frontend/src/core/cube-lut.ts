// CUBE conventions and tetrahedral ordering checked against AfterFrame's
// cubeLut.mjs / lutKernel.js (MIT; bundled licenses/AfterFrame-MIT.txt).
// Tables are immutable assets; recipes refer to their source-byte SHA-256.
export const MAX_CUBE_BYTES=32*1024*1024;
export const MAX_CUBE_SIZE=65;
export type CubeLut={title:string;size:number;domainMin:number[];domainMax:number[];table:Float32Array};
export class CubeError extends Error{
  readonly code:string;readonly line:number;
  constructor(code:string,line=0){super('Invalid CUBE LUT: '+code+(line?' (line '+line+')':''));this.name='CubeError';this.code=code;this.line=line;}
}
const decimal=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
function numbers(tokens:string[],length:number,line:number){
  if(tokens.length!==length||tokens.some(t=>!decimal.test(t)||!Number.isFinite(Number(t))))throw new CubeError('number',line);
  return tokens.map(Number);
}
function checkDomain(min:number[],max:number[],line=0){if(min.some((v,c)=>!(v<max[c])||!Number.isFinite(max[c]-v)))throw new CubeError('domain',line);}
export function parseCube(text:string):CubeLut{
  if(typeof text!=='string'||text.length>MAX_CUBE_BYTES||new TextEncoder().encode(text).length>MAX_CUBE_BYTES)throw new CubeError('file_size');
  if(text.includes('\0'))throw new CubeError('encoding');
  let title='',size=0,domainMin=[0,0,0],domainMax=[1,1,1],table:Float32Array|null=null,rows=0;
  const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/),seen=new Set<string>();
  for(let i=0;i<lines.length;i++){
    const raw=lines[i].trim(),line=i+1;
    if(/^TITLE\b/i.test(raw)){
      if(seen.has('TITLE'))throw new CubeError('duplicate_header',line);seen.add('TITLE');
      const value=raw.slice(5).trim();if(value.startsWith('"')){const match=/^"([^"\r\n]*)"\s*(?:#.*)?$/.exec(value);if(!match)throw new CubeError('title',line);title=match[1];}else title=value.split('#',1)[0].trim();
      if(title.length>255||/[\x00-\x1f\x7f]/.test(title))throw new CubeError('title',line);continue;
    }
    const clean=raw.split('#',1)[0].trim();if(!clean)continue;const parts=clean.split(/\s+/),key=parts[0].toUpperCase();
    if(/^(?:LUT_[12]D_|LUT_1D$)/.test(key))throw new CubeError('shaper_unsupported',line);
    if(['LUT_3D_SIZE','DOMAIN_MIN','DOMAIN_MAX','LUT_3D_INPUT_RANGE'].includes(key)){
      if(seen.has(key))throw new CubeError('duplicate_header',line);seen.add(key);
      if(key==='LUT_3D_SIZE'){if(table)throw new CubeError('late_size',line);[size]=numbers(parts.slice(1),1,line);if(!Number.isInteger(size)||size<2||size>MAX_CUBE_SIZE)throw new CubeError('size',line);}
      else if(key==='LUT_3D_INPUT_RANGE'){if(seen.has('DOMAIN_MIN')||seen.has('DOMAIN_MAX'))throw new CubeError('ambiguous_domain',line);const [lo,hi]=numbers(parts.slice(1),2,line);domainMin=[lo,lo,lo];domainMax=[hi,hi,hi];}
      else{if(seen.has('LUT_3D_INPUT_RANGE'))throw new CubeError('ambiguous_domain',line);if(key==='DOMAIN_MIN')domainMin=numbers(parts.slice(1),3,line);else domainMax=numbers(parts.slice(1),3,line);}
      continue;
    }
    // Vendor labels may be ignored. Numeric-looking invalid rows (including
    // NaN/Inf) must not disappear behind a successful row-count check.
    if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[0])&&!/^[+-]?(nan|inf(?:inity)?)$/i.test(parts[0]))continue;
    if(!size)throw new CubeError('missing_size',line);
    const values=numbers(parts,3,line);if(rows>=size**3)throw new CubeError('row_count',line);
    table??=new Float32Array(size**3*3);
    for(let c=0;c<3;c++){const value=Math.fround(values[c]);if(!Number.isFinite(value))throw new CubeError('number',line);table[rows*3+c]=value;}rows++;
  }
  if(!size)throw new CubeError('missing_size');checkDomain(domainMin,domainMax);
  if(!table||rows!==size**3)throw new CubeError('row_count');return {title,size,domainMin,domainMax,table};
}
export function validateCube(value:CubeLut){
  if(!value||!Number.isInteger(value.size)||value.size<2||value.size>MAX_CUBE_SIZE||!(value.table instanceof Float32Array)||value.table.length!==value.size**3*3||value.table.some(v=>!Number.isFinite(v)))throw new CubeError('table');
  for(const axis of [value.domainMin,value.domainMax])if(!Array.isArray(axis)||axis.length!==3||axis.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new CubeError('domain');
  checkDomain(value.domainMin,value.domainMax);
}
export type PreparedLut={size:number;table:Float32Array;axes:{index:Int32Array;fraction:Float64Array}[]};
export function prepareLut(lut:CubeLut):PreparedLut{
  validateCube(lut);const n=lut.size-1;
  return {size:lut.size,table:lut.table.slice(),axes:[0,1,2].map(c=>{
    const index=new Int32Array(256),fraction=new Float64Array(256);
    for(let v=0;v<256;v++){const position=Math.max(0,Math.min(1,(v/255-lut.domainMin[c])/(lut.domainMax[c]-lut.domainMin[c])))*n;index[v]=Math.min(n-1,Math.floor(position));fraction[v]=position-index[v];}
    return {index,fraction};
  })};
}
// sRGB-encoded RGB after photo adjustments, before all creative layers.
// Four vertices per lookup; no node clipping before interpolation/mixing.
// Alpha is unchanged, including hidden RGB under fully transparent pixels.
export function applyLut(pixels:Uint8ClampedArray,lut:PreparedLut,strength:number):Uint8ClampedArray{
  if(!(pixels instanceof Uint8ClampedArray)||pixels.length%4||!Number.isFinite(strength)||strength<0||strength>1)throw new CubeError('pixels');
  if(strength===0)return pixels;
  const t=lut.table,[ra,ga,ba]=lut.axes,sr=3,sg=3*lut.size,sb=3*lut.size*lut.size,all=sr+sg+sb;
  for(let p=0;p<pixels.length;p+=4){const r=pixels[p],g=pixels[p+1],b=pixels[p+2],fr=ra.fraction[r],fg=ga.fraction[g],fb=ba.fraction[b],offset=ra.index[r]*sr+ga.index[g]*sg+ba.index[b]*sb;
    let a:number,c:number,w0:number,w1:number,w2:number,w3:number;
    if(fr>=fg){if(fg>=fb){a=sr;c=sr+sg;w0=1-fr;w1=fr-fg;w2=fg-fb;w3=fb;}else if(fr>=fb){a=sr;c=sr+sb;w0=1-fr;w1=fr-fb;w2=fb-fg;w3=fg;}else{a=sb;c=sr+sb;w0=1-fb;w1=fb-fr;w2=fr-fg;w3=fg;}}
    else if(fb>fg){a=sb;c=sg+sb;w0=1-fb;w1=fb-fg;w2=fg-fr;w3=fr;}else if(fb>fr){a=sg;c=sg+sb;w0=1-fg;w1=fg-fb;w2=fb-fr;w3=fr;}else{a=sg;c=sr+sg;w0=1-fg;w1=fg-fr;w2=fr-fb;w3=fb;}
    for(let channel=0;channel<3;channel++){const at=offset+channel,graded=(t[at]*w0+t[at+a]*w1+t[at+c]*w2+t[at+all]*w3)*255;pixels[p+channel]+=strength*(graded-pixels[p+channel]);}
  }return pixels;
}
