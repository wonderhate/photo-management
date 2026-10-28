// Independent overlay format. Do not add these fields to legacy edit recipes:
// readers must explicitly support this format before accepting a saved overlay.
export const TEXT_FONT_IDS=['sans','serif','mono','fine','brush','calligraphy','chinese_brush','chinese_running','chinese_cursive','chinese_handwriting'] as const;
export type TextFont=typeof TEXT_FONT_IDS[number];
export type TextPaint={kind:'solid';color:string;opacity:number}|{kind:'linear';from:string;to:string;fromOpacity:number;toOpacity:number;angle:number};
export type TextLayer={
  id:string;kind:'text';text:string;visible:boolean;locked:boolean;
  x:number;y:number;rotation:number;font:TextFont;size:number;weight:number;italic:boolean;
  underline:boolean;strikethrough:boolean;letterSpacing:number;lineHeight:number;
  textCase:'none'|'upper'|'lower'|'title';align:'left'|'center'|'right';opacity:number;
  fill:TextPaint;stroke:{enabled:boolean;width:number;paint:TextPaint};
  background:{enabled:boolean;paint:TextPaint;padding:[number,number,number,number]};
  shadow:{enabled:boolean;color:string;opacity:number;x:number;y:number;blur:number};
  glow:{enabled:boolean;color:string;opacity:number;blur:number;passes:number};
};
export type TextLayerDocument={version:1;layers:TextLayer[]};
// All lengths use a 1920-long-edge canvas; position is normalized in that plane.
// Persisting this contract keeps preview scale out of the saved design.
export const TEXT_REFERENCE_EDGE=1920;
export const TEXT_LIMITS={layers:32,charactersPerLayer:8192,charactersTotal:32768,lines:128,logicalExtent:65536} as const;
function fail():never{throw new Error('Invalid text layers.');}
function object(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail();
  const actual=Object.keys(value);if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))fail();
}
function number(value:unknown,min:number,max:number,integer=false){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))fail();}
function bool(value:unknown){if(typeof value!=='boolean')fail();}
function color(value:unknown){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))fail();}
function choice(value:unknown,values:readonly unknown[]){if(!values.includes(value))fail();}
function paint(value:unknown):asserts value is TextPaint{
  if((value as TextPaint)?.kind==='solid'){object(value,['kind','color','opacity']);color(value.color);number(value.opacity,0,1);}
  else{object(value,['kind','from','to','fromOpacity','toOpacity','angle']);choice(value.kind,['linear']);color(value.from);color(value.to);number(value.fromOpacity,0,1);number(value.toOpacity,0,1);number(value.angle,-360,360);}
}
const keys=['id','kind','text','visible','locked','x','y','rotation','font','size','weight','italic','underline','strikethrough','letterSpacing','lineHeight','textCase','align','opacity','fill','stroke','background','shadow','glow'];
export function validateTextLayer(value:unknown):asserts value is TextLayer{
  object(value,keys);const v=value;
  if(typeof v.id!=='string'||!/^text-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id))fail();
  choice(v.kind,['text']);
  // Tabs/CR are normalized on entry; invisible control codes and unpaired UTF16
  // surrogates are rejected rather than silently changing a saved composition.
  if(typeof v.text!=='string'||v.text.length>TEXT_LIMITS.charactersPerLayer||v.text.split('\n').length>TEXT_LIMITS.lines||/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(v.text)||/[\ud800-\udfff]/u.test(v.text))fail();
  for(const key of ['visible','locked','italic','underline','strikethrough'])bool(v[key]);
  number(v.x,-4,5);number(v.y,-4,5);number(v.rotation,-180,180);choice(v.font,TEXT_FONT_IDS);number(v.size,1,1000);number(v.weight,100,900,true);
  number(v.letterSpacing,-.1,2);number(v.lineHeight,.5,5);choice(v.textCase,['none','upper','lower','title']);choice(v.align,['left','center','right']);number(v.opacity,0,1);paint(v.fill);
  object(v.stroke,['enabled','width','paint']);bool(v.stroke.enabled);number(v.stroke.width,0,100);paint(v.stroke.paint);
  object(v.background,['enabled','paint','padding']);bool(v.background.enabled);paint(v.background.paint);
  if(!Array.isArray(v.background.padding)||v.background.padding.length!==4)fail();for(const n of v.background.padding)number(n,0,1000);
  object(v.shadow,['enabled','color','opacity','x','y','blur']);bool(v.shadow.enabled);color(v.shadow.color);number(v.shadow.opacity,0,1);number(v.shadow.x,-1000,1000);number(v.shadow.y,-1000,1000);number(v.shadow.blur,0,200);
  object(v.glow,['enabled','color','opacity','blur','passes']);bool(v.glow.enabled);color(v.glow.color);number(v.glow.opacity,0,1);number(v.glow.blur,0,200);number(v.glow.passes,1,4,true);
}
export function validateTextLayers(value:unknown):asserts value is TextLayerDocument{
  object(value,['version','layers']);if(value.version!==1||!Array.isArray(value.layers)||value.layers.length>TEXT_LIMITS.layers)fail();
  const ids=new Set<string>();let total=0;
  for(const layer of value.layers){validateTextLayer(layer);if(ids.has(layer.id))fail();ids.add(layer.id);total+=layer.text.length;}
  if(total>TEXT_LIMITS.charactersTotal)fail();
}
export function newTextLayer(id:string,text=''):TextLayer{
  const layer:TextLayer={id,kind:'text',text:normalizeTextInput(text),visible:true,locked:false,x:.5,y:.5,rotation:0,font:'sans',size:120,weight:400,italic:false,underline:false,strikethrough:false,letterSpacing:0,lineHeight:1.2,textCase:'none',align:'center',opacity:1,
    fill:{kind:'solid',color:'#ffffff',opacity:1},stroke:{enabled:false,width:2,paint:{kind:'solid',color:'#000000',opacity:1}},background:{enabled:false,paint:{kind:'solid',color:'#000000',opacity:.8},padding:[15,25,15,25]},
    shadow:{enabled:false,color:'#000000',opacity:.6,x:0,y:4,blur:8},glow:{enabled:false,color:'#ffd76a',opacity:.8,blur:24,passes:2}};
  validateTextLayer(layer);return layer;
}
export function normalizeTextInput(text:string){return text.replace(/\r\n?/g,'\n').replace(/\t/g,'    ');}
export function displayText(layer:Pick<TextLayer,'text'|'textCase'>){
  if(layer.textCase==='upper')return layer.text.toUpperCase();if(layer.textCase==='lower')return layer.text.toLowerCase();
  if(layer.textCase==='title'){const segments=new Intl.Segmenter('und',{granularity:'grapheme'});return layer.text.replace(/\S+/gu,word=>{const first=segments.segment(word)[Symbol.iterator]().next().value!.segment;return first.toUpperCase()+word.slice(first.length);});}
  return layer.text;
}
// Explicit, immutable operations make copying/pasting safe and retain complete
// document values for the editor's undo stack. IDs are supplied by the caller.
export function duplicateTextLayer(document:TextLayerDocument,id:string,newId:string):TextLayerDocument{
  validateTextLayers(document);const result=structuredClone(document),index=result.layers.findIndex(layer=>layer.id===id);if(index<0)fail();
  const copy=structuredClone(result.layers[index]);copy.id=newId;copy.x=Math.min(5,copy.x+.02);copy.y=Math.min(5,copy.y+.02);result.layers.splice(index+1,0,copy);validateTextLayers(result);return result;
}
export function reorderTextLayers(document:TextLayerDocument,ids:readonly string[]):TextLayerDocument{
  validateTextLayers(document);if(ids.length!==document.layers.length||new Set(ids).size!==ids.length)fail();const byId=new Map(document.layers.map(layer=>[layer.id,layer]));
  const result:TextLayerDocument={version:1,layers:ids.map(id=>{const value=byId.get(id);if(!value)fail();return structuredClone(value);})};validateTextLayers(result);return result;
}
