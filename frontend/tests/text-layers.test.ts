import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newTextLayer,validateTextLayer,validateTextLayers,duplicateTextLayer,reorderTextLayers,displayText,TEXT_LIMITS} from '../src/core/text-layers.ts';
import {layoutTextLayer,textLayerTransform,transformedTextBounds,hitTextLayer} from '../src/core/text-layout.ts';
import type {TextLayer} from '../src/core/text-layers.ts';
import {TEXT_PRESETS,applyTextPreset} from '../src/core/text-presets.ts';
const id=(n:number)=>`text-00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const measure=(text:string,layer:TextLayer)=>({width:text.length*layer.size/2,left:text?layer.size*.1:0,right:text.length*layer.size/2+(text?layer.size*.2:0),ascent:text?layer.size:0,descent:text?layer.size*.3:0});

test('all local typography presets preserve content and position and fully reset earlier effects',()=>{
  const original={...newTextLayer(id(1),'原文 é'),x:.27,y:.73,visible:false,locked:true},before=structuredClone(original);
  assert.equal(TEXT_PRESETS.length,17);
  for(const p of TEXT_PRESETS){const next=applyTextPreset(original,p.id);validateTextLayer(next);for(const key of ['id','text','x','y','visible','locked'] as const)assert.equal(next[key],original[key]);}
  const seal=applyTextPreset(original,'seal'),ghost=applyTextPreset(seal,'ghost'),dune=applyTextPreset(ghost,'dune');assert.equal(seal.background.enabled,true);assert.equal(ghost.background.enabled,false);assert.equal(ghost.stroke.enabled,true);assert.equal(dune.stroke.enabled,false);assert.equal(dune.fill.kind,'solid');assert.equal(dune.fill.opacity,1);assert.equal(dune.shadow.enabled,false);assert.deepEqual(original,before);
  seal.background.padding[0]=999;assert.equal(applyTextPreset(original,'seal').background.padding[0],22);assert.throws(()=>applyTextPreset(original,'unknown'));
});

test('versioned text documents reject unknown data, external fonts and resource explosions',()=>{
  const valid=newTextLayer(id(1),'光影集\nÁ 👨‍👩‍👧‍👦');validateTextLayers({version:1,layers:[valid]});
  for(const patch of [{kind:'image'},{font:'https://fonts.invalid/remote.ttf'},{id:'text-1'},{size:NaN},{weight:true},{opacity:1.1},{rotation:Infinity},{future:1},{text:'bad\ud800'},{text:'bad\u0000'},{text:'\n'.repeat(128)},{text:'a'.repeat(8193)},{stroke:{...valid.stroke,future:1}},{fill:{kind:'solid',color:'url(remote)',opacity:1}},{glow:{...valid.glow,passes:1000}}])assert.throws(()=>validateTextLayer({...valid,...patch}));
  assert.throws(()=>validateTextLayers({version:2,layers:[valid]}));assert.throws(()=>validateTextLayers({version:1,layers:[valid,valid]}));
  assert.throws(()=>validateTextLayers({version:1,layers:Array.from({length:33},(_,i)=>newTextLayer(id(i)))}));
  assert.throws(()=>validateTextLayers({version:1,layers:Array.from({length:5},(_,i)=>newTextLayer(id(i),'a'.repeat(8192)))}));
  assert.equal(newTextLayer(id(2),'a\r\nb\rc\td').text,'a\nb\nc    d');
});
test('text transforms preserve grapheme clusters, whitespace and literal markup',()=>{
  const layer=newTextLayer(id(1),'élan   hello\n中国 👩🏽‍💻 <script>');assert.equal(displayText({...layer,textCase:'title'}),'Élan   Hello\n中国 👩🏽‍💻 <script>');
  assert.equal(displayText({...layer,text:'straße',textCase:'upper'}),'STRASSE');assert.equal(displayText({...layer,text:'İ',textCase:'lower'}),'i̇');assert.equal(displayText(layer),layer.text);
});
test('copy/reorder preserves original document and independent nested styles for undo',()=>{
  const first=newTextLayer(id(1),'first'),document={version:1 as const,layers:[first]},before=structuredClone(document),copied=duplicateTextLayer(document,id(1),id(2));
  assert.deepEqual(document,before);assert.equal(copied.layers[1].x,.52);copied.layers[1].background.padding[0]=88;assert.equal(copied.layers[0].background.padding[0],15);
  const ordered=reorderTextLayers(copied,[id(2),id(1)]);assert.deepEqual(ordered.layers.map(l=>l.id),[id(2),id(1)]);assert.equal(copied.layers[0].id,id(1));
  assert.throws(()=>duplicateTextLayer(document,id(9),id(3)));assert.throws(()=>duplicateTextLayer(document,id(1),id(1)));assert.throws(()=>reorderTextLayers(copied,[id(1),id(1)]));assert.throws(()=>reorderTextLayers(copied,[id(2)]));
});
test('layout preserves blank lines, alignment, swashes, descenders and decoration bounds',()=>{
  const layer=newTextLayer(id(1),'wide\nx\n');layer.align='left';layer.lineHeight=.5;layer.underline=true;
  const layout=layoutTextLayer(layer,measure);assert.equal(layout.lines.length,3);assert.equal(layout.lines[2].text,'');assert.equal(layout.lines[0].x,layout.lines[1].x);assert.equal(layout.lines[1].baseline-layout.lines[0].baseline,60);
  assert.ok(layout.ink.x<layout.box.x);assert.ok(layout.ink.width>layout.box.width);assert.ok(layout.background.y<=layout.ink.y-15);
  const right=layoutTextLayer({...layer,align:'right'},measure);assert.equal(right.lines[0].x+right.lines[0].width,right.lines[1].x+right.lines[1].width);
  const centered=layoutTextLayer({...layer,align:'center'},measure);assert.equal(centered.lines[0].x+centered.lines[0].width/2,0);assert.equal(centered.lines[1].x+centered.lines[1].width/2,0);
});
test('rotation and preview scaling use one layout plane and inverse hit detection',()=>{
  const layer=newTextLayer(id(1),'rotate');layer.rotation=37;const layout=layoutTextLayer(layer,measure),small=textLayerTransform(layer,960,640),large=textLayerTransform(layer,1920,1280),a=transformedTextBounds(layout.background,small),b=transformedTextBounds(layout.background,large);
  for(const key of ['x','y','width','height'] as const)assert.ok(Math.abs(a[key]*2-b[key])<1e-7);
  assert.equal(hitTextLayer({x:480,y:320},layout.background,small),true);assert.equal(hitTextLayer({x:1,y:1},layout.background,small),false);assert.equal(hitTextLayer({x:0,y:0},layout.background,[0,0,0,0,0,0]),false);
  assert.throws(()=>textLayerTransform(layer,10001,10000));assert.throws(()=>textLayerTransform(layer,NaN,100));
});
test('effect extents include padding and negative shadow while hostile metrics fail boundedly',()=>{
  const layer=newTextLayer(id(1),'hello');layer.background.enabled=true;layer.background.padding=[40,50,60,70];layer.stroke.enabled=true;layer.stroke.width=20;layer.shadow={enabled:true,x:-200,y:100,blur:20,color:'#000000',opacity:.7};layer.glow.enabled=true;
  const r=layoutTextLayer(layer,measure);assert.ok(r.effects.x<=r.ink.x-270);assert.ok(r.effects.y+r.effects.height>=r.ink.y+r.ink.height+170);assert.ok(r.effects.x<=r.background.x);
  for(const width of [NaN,Infinity,-1,TEXT_LIMITS.logicalExtent+1])assert.throws(()=>layoutTextLayer(layer,()=>({width,left:0,right:1,ascent:1,descent:1})));
  assert.throws(()=>layoutTextLayer({...layer,text:'a'.repeat(8192)},measure));
});
