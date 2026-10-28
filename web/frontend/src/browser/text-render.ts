import {fontFiles} from './render';
import {validateTextLayers} from '../core/text-layers';
import type {TextFont,TextLayer,TextLayerDocument,TextPaint} from '../core/text-layers';
import {layoutTextLayer,textLayerTransform,transformedTextBounds} from '../core/text-layout';
import type {TextLayout,TextRect} from '../core/text-layout';
import type {TextTransform} from '../core/text-layout';
import {multiplyTextTransforms} from '../core/text-recipe';

type Context=OffscreenCanvasRenderingContext2D;
const loaded=new Map<string,Promise<string>>();
async function localFont(id:string):Promise<string>{
  if(!Object.hasOwn(fontFiles,id))throw new Error('Unknown local text font.');
  if(!loaded.has(id)){
    const pending=(async()=>{const response=await fetch('/local-assets/signatures/'+fontFiles[id]);if(!response.ok)throw new Error('Text font is unavailable.');
      const name='pc-text-'+id,face=await new FontFace(name,await response.arrayBuffer()).load();
      const fonts=(globalThis as unknown as {fonts?:FontFaceSet;document?:Document}).fonts??globalThis.document?.fonts;
      if(!fonts)throw new Error('Text fonts are unavailable in this renderer.');fonts.add(face);return name;
    })();loaded.set(id,pending);pending.catch(()=>{if(loaded.get(id)===pending)loaded.delete(id);});
  }
  return loaded.get(id)!;
}
export async function textFontFamily(font:TextFont){
  const fallback=await localFont('chinese_brush'),system=font==='sans'?'sans-serif':font==='serif'?'serif':font==='mono'?'monospace':null;
  return system?`${system}, "${fallback}"`:`"${await localFont(font)}", "${fallback}", sans-serif`;
}
function setup(ctx:Context,layer:TextLayer,family:string){
  ctx.font=`${layer.italic?'italic ':''}${layer.weight} ${layer.size}px ${family}`;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.direction='ltr';
  if(!('letterSpacing' in ctx)&&layer.letterSpacing!==0)throw new Error('Text spacing is not supported in this browser.');
  ctx.letterSpacing=`${layer.letterSpacing*layer.size}px`;
}
function measure(ctx:Context,text:string){const m=ctx.measureText(text);return {width:m.width,left:m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent};}
function rgba(color:string,opacity:number){return color+Math.round(opacity*255).toString(16).padStart(2,'0');}
function paint(ctx:Context,value:TextPaint,rect:TextRect){
  if(value.kind==='solid')return rgba(value.color,value.opacity);
  // CSS convention: 0deg points up; 90deg points right. Project the rectangle
  // corners onto that direction to fill the entire box at every angle.
  const angle=value.angle*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle),radius=(Math.abs(dx)*rect.width+Math.abs(dy)*rect.height)/2,cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
  const gradient=ctx.createLinearGradient(cx-dx*radius,cy-dy*radius,cx+dx*radius,cy+dy*radius);gradient.addColorStop(0,rgba(value.from,value.fromOpacity));gradient.addColorStop(1,rgba(value.to,value.toOpacity));return gradient;
}
function glyphs(ctx:Context,layer:TextLayer,layout:TextLayout,stroke=false){
  for(const line of layout.lines){if(!line.text)continue;if(stroke)ctx.strokeText(line.text,line.x,line.baseline);else ctx.fillText(line.text,line.x,line.baseline);
    const thickness=Math.max(1,layer.size/16);
    for(const offset of [layer.underline?layer.size*.12:null,layer.strikethrough?-layer.size*.3:null])if(offset!==null){if(stroke)ctx.strokeRect(line.x,line.baseline+offset,line.width,thickness);else ctx.fillRect(line.x,line.baseline+offset,line.width,thickness);}
  }
}
export type TextRenderResult={id:string;layout:TextLayout}[];
// A single canonical canvas path is intended for both preview and full export.
// This foundation is deliberately not wired into legacy recipes or persistence.
export async function drawTextLayers(ctx:Context,document:TextLayerDocument,view?:{reference:{width:number;height:number};transform:TextTransform}):Promise<TextRenderResult>{
  validateTextLayers(document);const frozen=structuredClone(document),{width,height}=ctx.canvas;
  if(width<1||height<1||width*height>100_000_000)throw new Error('Invalid text canvas.');
  // Preflight all fonts and layouts before touching the destination. A failed
  // load must not leave a partially drawn output, and retry must be possible.
  const probe=new OffscreenCanvas(1,1),metrics=probe.getContext('2d')!,ready=[];
  for(const layer of frozen.layers){if(!layer.visible||layer.opacity===0||!layer.text)continue;const family=await textFontFamily(layer.font);setup(metrics,layer,family);const layout=layoutTextLayer(layer,text=>measure(metrics,text)),local=textLayerTransform(layer,view?.reference.width??width,view?.reference.height??height),transform=view?multiplyTextTransforms(view.transform,local):local,bounds=transformedTextBounds(layout.effects,transform);ready.push({layer,family,layout,transform,bounds});}
  const scratch=new OffscreenCanvas(1,1),out=scratch.getContext('2d')!;
  try{
    for(const {layer,family,layout,transform,bounds} of ready){
      // Only allocate the visible layer region, including effects and AA guard.
      // A short caption on a 100 MP image must not allocate four 100 MP buffers.
      if(bounds.x+bounds.width<0||bounds.y+bounds.height<0||bounds.x>width||bounds.y>height)continue;
      // Retain off-canvas glyphs whose shadow reaches the image. Clipping the
      // mask to the photo before blurring would silently lose that shadow.
      const scale=Math.max(Math.hypot(transform[0],transform[1]),Math.hypot(transform[2],transform[3]));
      const halo=Math.ceil(Math.max(layer.shadow.enabled?layer.shadow.blur*3+Math.abs(layer.shadow.x)+Math.abs(layer.shadow.y):0,layer.glow.enabled?layer.glow.blur*3:0)*scale)+2;
      const left=Math.max(-halo,Math.floor(bounds.x)-2),top=Math.max(-halo,Math.floor(bounds.y)-2),right=Math.min(width+halo,Math.ceil(bounds.x+bounds.width)+2),bottom=Math.min(height+halo,Math.ceil(bounds.y+bounds.height)+2);
      if(right<=left||bottom<=top)continue;
      if((right-left)*(bottom-top)>16_000_000||right-left>16000||bottom-top>16000)throw new Error('Text effects exceed the supported canvas size. Reduce the text size or export dimensions.');
      scratch.width=right-left;scratch.height=bottom-top;
      const local:[number,number,number,number,number,number]=[...transform];local[4]-=left;local[5]-=top;
      // Isolate the whole layer so opacity applies once at overlapping fill,
      // stroke, decoration and background pixels. Reuse a bounded canvas.
      out.setTransform(...local);setup(out,layer,family);
      if(layer.background.enabled){out.fillStyle=paint(out,layer.background.paint,layout.background);const b=layout.background;out.fillRect(b.x,b.y,b.width,b.height);}
      out.lineJoin='round';out.lineWidth=layer.stroke.width;
      // Tint a glyph silhouette before blur. Drawing a white source plus its
      // shadow and then erasing that source leaves white antialiasing fringes.
      if(layer.glow.enabled||layer.shadow.enabled){
        const mask=new OffscreenCanvas(scratch.width,scratch.height),m=mask.getContext('2d')!;
        try{m.setTransform(...local);setup(m,layer,family);m.fillStyle='#ffffff';m.strokeStyle='#ffffff';m.lineJoin='round';m.lineWidth=layer.stroke.width;glyphs(m,layer,layout);if(layer.stroke.enabled&&layer.stroke.width>0)glyphs(m,layer,layout,true);
          out.save();out.resetTransform();
          const effect=(color:string,opacity:number,blur:number,x:number,y:number,passes:number)=>{
            const c=new OffscreenCanvas(scratch.width,scratch.height),e=c.getContext('2d')!;
            try{e.drawImage(mask,0,0);e.globalCompositeOperation='source-in';e.fillStyle=rgba(color,opacity);e.fillRect(0,0,c.width,c.height);out.filter=blur?`blur(${blur*scale/2}px)`:'none';for(let i=0;i<passes;i++)out.drawImage(c,transform[0]*x+transform[2]*y,transform[1]*x+transform[3]*y);out.filter='none';}finally{c.width=1;c.height=1;}
          };
          if(layer.glow.enabled)effect(layer.glow.color,layer.glow.opacity,layer.glow.blur,0,0,layer.glow.passes);
          if(layer.shadow.enabled)effect(layer.shadow.color,layer.shadow.opacity,layer.shadow.blur,layer.shadow.x,layer.shadow.y,1);
          out.restore();
        }finally{mask.width=1;mask.height=1;}
      }
      if(layer.stroke.enabled&&layer.stroke.width>0){out.strokeStyle=paint(out,layer.stroke.paint,layout.ink);glyphs(out,layer,layout,true);}
      out.fillStyle=paint(out,layer.fill,layout.ink);glyphs(out,layer,layout);
      ctx.save();try{ctx.resetTransform();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=layer.opacity;ctx.drawImage(scratch,left,top);}finally{ctx.restore();}
    }
  }finally{scratch.width=1;scratch.height=1;probe.width=1;probe.height=1;}
  return ready.map(({layer,layout})=>({id:layer.id,layout}));
}
