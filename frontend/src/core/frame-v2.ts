// Template geometry adapted from AfterFrame, MIT, commit
// 26e19935469e696133088b798f23b5b3654d910f. See public/licenses/AfterFrame-MIT.txt.
import templates from './frame-templates.json' with {type:'json'};
export type FrameAnchor={region:'top'|'bottom'|'left'|'right'|'full';h:'left'|'center'|'right';v:'top'|'center'|'bottom'|number;inset?:number;dx?:number;dy?:number};
export type FrameStyle={font?:'grotesk'|'serif'|'mono'|'hand';weight?:number;size:number;color?:string;opacity?:number;rotation?:number;tracking?:number};
export type FrameElement={type:'text'|'exif'|'logo';anchor:FrameAnchor;style:FrameStyle;content?:string;fields?:string[];group?:string;labeled?:boolean;variant?:'symbol'|'wordmark';strict?:boolean;color?:string;soloAnchor?:Partial<FrameAnchor>};
export type FrameTemplate={id:string;name:string;family:string;canvas:{pad:Partial<Record<'top'|'right'|'bottom'|'left',number>>;bg:{type:'solid';color:string};scrim?:{edge?:'top'|'bottom';from:string;to:string;height:number}};elements:FrameElement[]};
export type LogoAsset={id:string;name:string;make:string;variant:'symbol'|'wordmark'|'both';source:string;license:string;data_url:string;width:number;height:number;sha256:string};
export type FrameDocument={version:2;template:FrameTemplate;margin:number;text_scale:number;tokens:Record<string,string>;logo:LogoAsset|null;logo_mode:'auto'|'manual'|'none';logo_tone:'auto'|'original'|'black'|'white'|'gold'};
export type FrameUserTemplate={version:2;id:string;name:string;template:FrameTemplate;margin:number;text_scale:number};
export const FRAME_TEMPLATES=templates as FrameTemplate[];
const plain=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>plain(v)&&Object.keys(v).every(k=>keys.includes(k));
const number=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f\ud800-\udfff]/u.test(v);
const color=(v:unknown)=>typeof v==='string'&&/^#[a-f0-9]{6}$/i.test(v);
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v);
function fail():never{throw new Error('Invalid v2 frame document.');}
function anchor(v:unknown){
  if(!exact(v,['region','h','v','inset','dx','dy']))fail();const a=v as FrameAnchor;
  if(!['top','bottom','left','right','full'].includes(a.region)||!['left','center','right'].includes(a.h)||!(['top','center','bottom'].includes(a.v as string)||number(a.v,0,1)))fail();
  if(a.inset!==undefined&&!number(a.inset,0,.5)||a.dx!==undefined&&!number(a.dx,-1,1)||a.dy!==undefined&&!number(a.dy,-1,1))fail();
}
export function validateFrameTemplate(value:unknown):asserts value is FrameTemplate{
  const v=value as FrameTemplate;
  if(!exact(v,['id','name','family','canvas','elements'])||!id(v.id)||!text(v.name,120)||!v.name.trim()||!text(v.family,40)||!exact(v.canvas,['pad','bg','scrim'])||!exact(v.canvas.pad,['top','right','bottom','left'])||Object.values(v.canvas.pad).some(n=>!number(n,0,.5))||!exact(v.canvas.bg,['type','color'])||v.canvas.bg.type!=='solid'||!color(v.canvas.bg.color)||!Array.isArray(v.elements)||v.elements.length>32)fail();
  if(v.canvas.scrim!==undefined){const s=v.canvas.scrim;if(!exact(s,['edge','from','to','height'])||s.edge!==undefined&&!['top','bottom'].includes(s.edge)||!number(s.height,.01,1)||![s.from,s.to].every(c=>typeof c==='string'&&/^rgba\(0,0,0,(?:0|1|0?\.\d{1,3})\)$/.test(c)&&Number(c.slice(11,-1))<=1))fail();}
  for(const e of v.elements){
    if(!exact(e,['type','anchor','style','content','fields','group','labeled','variant','strict','color','soloAnchor'])||!['text','exif','logo'].includes(e.type))fail();anchor(e.anchor);
    if(e.soloAnchor!==undefined){if(!plain(e.soloAnchor))fail();anchor({...e.anchor,...e.soloAnchor});}
    const s=e.style;if(!exact(s,['font','weight','size','color','opacity','rotation','tracking'])||!number(s.size,.004,.3)||s.font!==undefined&&!['grotesk','serif','mono','hand'].includes(s.font)||s.weight!==undefined&&(!number(s.weight,100,900)||!Number.isInteger(s.weight))||s.color!==undefined&&!color(s.color)||s.opacity!==undefined&&!number(s.opacity,0,100)||s.rotation!==undefined&&!number(s.rotation,-180,180)||s.tracking!==undefined&&!number(s.tracking,-.1,1))fail();
    if(e.type==='text'&&!text(e.content,1000)||e.content!==undefined&&!text(e.content,1000)||e.group!==undefined&&!text(e.group,40)||e.color!==undefined&&!color(e.color)||e.variant!==undefined&&!['symbol','wordmark'].includes(e.variant)||e.strict!==undefined&&typeof e.strict!=='boolean'||e.labeled!==undefined&&typeof e.labeled!=='boolean')fail();
    if(e.type==='exif'&&!Array.isArray(e.fields)||e.fields!==undefined&&(!Array.isArray(e.fields)||e.fields.length>8||e.fields.some(f=>!['focal','aperture','shutter','iso'].includes(f))))fail();
  }
}
export function validateLogo(value:unknown):asserts value is LogoAsset{
  const v=value as LogoAsset;
  if(!exact(v,['id','name','make','variant','source','license','data_url','width','height','sha256'])||!id(v.id)||!text(v.name,120)||!v.name.trim()||!text(v.make,200)||!['symbol','wordmark','both'].includes(v.variant)||!text(v.source,500)||!v.source.trim()||!text(v.license,500)||!v.license.trim()||typeof v.data_url!=='string'||v.data_url.length>3_000_000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(v.data_url)||!Number.isInteger(v.width)||!Number.isInteger(v.height)||!number(v.width,1,2048)||!number(v.height,1,2048)||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))throw new Error('Invalid logo asset.');
}
export function validateFrame(value:unknown):asserts value is FrameDocument{
  const v=value as FrameDocument;
  if(!exact(v,['version','template','margin','text_scale','tokens','logo','logo_mode','logo_tone'])||v.version!==2||!number(v.margin,.1,3)||!number(v.text_scale,.5,2)||!plain(v.tokens)||Object.keys(v.tokens).length>32||Object.entries(v.tokens).some(([k,t])=>!/^[a-z][a-z0-9_]{0,31}$/.test(k)||!text(t,500))||!['auto','manual','none'].includes(v.logo_mode)||!['auto','original','black','white','gold'].includes(v.logo_tone))fail();
  validateFrameTemplate(v.template);if(v.logo!==null)validateLogo(v.logo);if(v.logo_mode==='none'&&v.logo!==null||v.logo_mode==='manual'&&v.logo===null)fail();
}
export function validateUserFrame(value:unknown):asserts value is FrameUserTemplate{
  const v=value as FrameUserTemplate;if(!exact(v,['version','id','name','template','margin','text_scale'])||v.version!==2||!id(v.id)||!text(v.name,120)||!v.name.trim()||!number(v.margin,.1,3)||!number(v.text_scale,.5,2))fail();validateFrameTemplate(v.template);
}
export function frameText(element:FrameElement,tokens:Record<string,string>){
  if(element.type==='logo')return '';
  if(element.type==='text')return (element.content||'').replace(/\{([a-z][a-z0-9_]*)\}/g,(_,key)=>Object.hasOwn(tokens,key)?tokens[key]:'');
  const labels:Record<string,string>={focal:'Focal',aperture:'Aperture',shutter:'Shutter',iso:'ISO'};
  return (element.fields||[]).filter(k=>tokens[k]).map(k=>element.labeled?`${labels[k]} | ${tokens[k].replace(/^ISO /,'')}`:tokens[k]).join(element.labeled?'       ':'   |   ');
}
export function frameGeometry(width:number,height:number,doc:FrameDocument,edge=0){
  validateFrame(doc);if(!Number.isInteger(width)||!Number.isInteger(height)||!number(width,1,100000)||!number(height,1,100000)||width*height>100_000_000||!Number.isInteger(edge)||!number(edge,0,16000))fail();
  const unit=Math.min(width,height)*1.5,pad=Object.fromEntries(['top','right','bottom','left'].map(k=>[k,(doc.template.canvas.pad[k as keyof FrameTemplate['canvas']['pad']]||0)*unit*doc.margin])) as Record<'top'|'right'|'bottom'|'left',number>;
  const fullWidth=Math.round(width+pad.left+pad.right),fullHeight=Math.round(height+pad.top+pad.bottom),scale=edge?Math.min(1,edge/Math.max(fullWidth,fullHeight)):1,outWidth=Math.max(1,Math.round(fullWidth*scale)),outHeight=Math.max(1,Math.round(fullHeight*scale));
  if(outWidth>16000||outHeight>16000||outWidth*outHeight>64_000_000)throw new Error('Frame export exceeds 16000 pixels or 64 megapixels. Select an explicit output edge.');
  return {unit,pad,fullWidth,fullHeight,scale,width:outWidth,height:outHeight};
}
export function frameLayers(width:number,height:number,doc:FrameDocument,edge=0){
  const g=frameGeometry(width,height,doc,edge),groups=new Map<string,number[]>(),offsets=new Map<number,number>();
  const elements=doc.template.elements;
  elements.forEach((e,i)=>{if(e.group&&e.type!=='logo'&&frameText(e,doc.tokens)){const members=groups.get(e.group)||[];members.push(i);groups.set(e.group,members);}});
  for(const members of groups.values()){const heights=members.map(i=>elements[i].style.size*doc.text_scale*1.6);let y=-heights.reduce((a,b)=>a+b,0)/2;members.forEach((i,k)=>{offsets.set(i,y+heights[k]/2);y+=heights[k];});}
  const logos=elements.filter(e=>e.type==='logo'&&doc.logo&&(!e.strict||doc.logo.variant==='both'||doc.logo.variant===e.variant));
  const layers=elements.flatMap((e,i)=>{
    if(e.type==='logo'&&(!doc.logo||e.strict&&doc.logo.variant!=='both'&&doc.logo.variant!==e.variant))return [];
    const content=frameText(e,doc.tokens);if(e.type!=='logo'&&!content)return [];
    const a={...e.anchor,...(logos.length===1&&e.type==='logo'?e.soloAnchor:{})},u=g.unit*doc.margin,inset=(a.inset??.05)*u,dx=(a.dx||0)*u,dy=((a.dy||0)+(offsets.get(i)||0))*u;
    let x:number,y:number,align=a.h;
    if(a.region==='left'||a.region==='right'){const left=a.region==='left'?0:g.fullWidth-g.pad.right,w=g.pad[a.region];x=left+w*(a.h==='left'?.3:a.h==='right'?.7:.5)+dx;y=g.fullHeight*(typeof a.v==='number'?a.v:a.v==='top'?.12:a.v==='bottom'?.88:.5)+dy;align='center';}
    else{const top=a.region==='bottom'?g.fullHeight-g.pad.bottom:0,h=a.region==='top'?g.pad.top:a.region==='bottom'?g.pad.bottom:g.fullHeight;x=(a.h==='left'?inset:a.h==='right'?g.fullWidth-inset:g.fullWidth/2)+dx;y=top+h*(typeof a.v==='number'?a.v:a.v==='top'?.32:a.v==='bottom'?.68:.5)+dy;}
    return [{element:e,text:content,x,y,align,size:e.style.size*g.unit*(e.type==='logo'?1:doc.text_scale)}];
  });return {...g,layers};
}
