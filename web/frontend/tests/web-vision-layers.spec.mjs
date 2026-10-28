import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
let bundle;
test.beforeAll(async()=>{bundle=(await build({stdin:{contents:"export * from './layer-render.ts'; export * from '../core/layer-stack.ts'; export * from '../core/layer-geometry.ts'; export * from '../core/editing.ts'; export * from '../core/layer-recipe.ts';",resolveDir:fileURLToPath(new URL('../src/browser/',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;});
test('sticker silhouettes, depth feather and mixed order share actual output pixels',async({page,context})=>{
 await context.route('**/__vision-layers.js',r=>r.fulfill({contentType:'text/javascript',body:bundle}));
 await context.route('**/__vision-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Vision layer pixels</title>'}));await page.goto('/__vision-fixture');
 const result=await page.evaluate(async()=>{
  const m=await import('/__vision-layers.js'),source={width:192,height:128},r=m.neutralRecipe();
  const png=new OffscreenCanvas(32,32),px=png.getContext('2d');px.fillStyle='#ff0000';px.fillRect(8,4,16,24);
  const bitmap=await createImageBitmap(png),mask=new OffscreenCanvas(192,128),mx=mask.getContext('2d');mx.fillStyle='#000000';mx.fillRect(0,0,96,128);mx.fillStyle='#ffffff';mx.fillRect(96,0,96,128);
  const depth=await createImageBitmap(mask),asset='a'.repeat(64),depthID='b'.repeat(64),layer=m.newSticker('sticker-00000000-0000-4000-8000-000000000001',{id:asset,name:'Subject',width:32,height:32});layer.width=1000;layer.height=1000;layer.stroke={enabled:true,color:'#ffffff',width:30};
  layer.depth={asset_hash:depthID,source_hash:'c'.repeat(64),threshold:.5,feather:.1,invert:false};
  const doc=m.upgradeLayerDocument({version:1,layers:[]},r,source);doc.layers=[layer];const canvas=new OffscreenCanvas(192,128),ctx=canvas.getContext('2d'),assets=new Map([[asset,bitmap],[depthID,depth]]),view=m.layerRenderView(doc,r,r,source,source);
  await m.drawLayerStack(ctx,doc,view,assets);const near=[...ctx.getImageData(110,64,1,1).data],far=[...ctx.getImageData(82,64,1,1).data],corner=[...ctx.getImageData(52,24,1,1).data];
  const overlay=m.newOverlay('overlay-00000000-0000-4000-8000-000000000002');overlay.coverage=1;overlay.paint={kind:'solid',color:'#0000ff',opacity:1};
  doc.layers=[layer,overlay];ctx.clearRect(0,0,192,128);await m.drawLayerStack(ctx,doc,view,assets);const covered=[...ctx.getImageData(82,64,1,1).data];
  doc.layers.reverse();ctx.clearRect(0,0,192,128);await m.drawLayerStack(ctx,doc,view,assets);const reordered=[...ctx.getImageData(82,64,1,1).data];bitmap.close();depth.close();return {near,far,corner,covered,reordered};
 });
 expect(result.near[3]).toBe(0);expect(result.far).toEqual([255,0,0,255]);expect(result.corner[3]).toBe(0);expect(result.covered).toEqual([0,0,255,255]);expect(result.reordered).toEqual([255,0,0,255]);
});
