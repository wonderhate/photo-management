import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
let bundle;
test.beforeAll(async()=>{bundle=(await build({stdin:{contents:"export * from './layer-render.ts'; export * from '../core/layer-stack.ts'; export * from '../core/text-layers.ts';",resolveDir:fileURLToPath(new URL('../src/browser/',import.meta.url)),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;});
async function setup(page,context){await context.route('**/__layers.js',r=>r.fulfill({contentType:'text/javascript',body:bundle}));await context.route('**/__layers-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Layer pixel fixture</title>'}));await page.goto('/__layers-fixture');await page.evaluate(async()=>{window.layers=await import('/__layers.js');});}
test('overlay alpha, all coverage edges and multiple color stops follow the target photo rectangle',async({page,context})=>{
  await setup(page,context);const result=await page.evaluate(async()=>{
    const m=window.layers,c=new OffscreenCanvas(100,100),ctx=c.getContext('2d'),l=m.newOverlay('overlay-00000000-0000-4000-8000-000000000001'),view={reference:{width:17,height:13},transform:[.3,0,0,.4,30,20]},sample=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data),edges=[];
    l.opacity=.5;l.paint={kind:'solid',color:'#ff0000',opacity:.5};l.coverage=.5;
    for(const edge of ['top','bottom','left','right']){ctx.clearRect(0,0,100,100);l.edge=edge;await m.drawLayerStack(ctx,{version:1,layers:[l]},view);edges.push([sample(10,10),sample(90,10),sample(10,90),sample(90,90)]);}
    ctx.clearRect(0,0,100,100);l.opacity=1;l.coverage=1;l.paint={kind:'linear',angle:0,stops:[{offset:0,color:'#ff0000',opacity:1},{offset:.5,color:'#00ff00',opacity:1},{offset:1,color:'#0000ff',opacity:1}]};await m.drawLayerStack(ctx,{version:1,layers:[l]},view);return {edges,gradient:[sample(0,50),sample(49,50),sample(99,50)]};
  });const red=[255,0,0,64],clear=[0,0,0,0];expect(result.edges).toEqual([[red,red,clear,clear],[clear,clear,red,red],[red,clear,red,clear],[clear,red,clear,red]]);
  for(const [row,channel] of result.gradient.map((row,i)=>[row,i])){expect(row[channel]).toBeGreaterThanOrEqual(252);expect(row[3]).toBe(255);for(let k=0;k<3;k++)if(k!==channel)expect(row[k]).toBeLessThanOrEqual(3);}
});
test('mixed rendering freezes paint while local text loads and ordering changes actual pixels',async({page,context})=>{
  await setup(page,context);const result=await page.evaluate(async()=>{const m=window.layers,l=m.newOverlay('overlay-00000000-0000-4000-8000-000000000001'),t=m.newTextLayer('text-00000000-0000-4000-8000-000000000001','M 光影');t.size=500;t.font='chinese_brush';l.coverage=1;l.paint={kind:'solid',color:'#ff0000',opacity:1};const doc={version:1,layers:[t,l]},frozen=structuredClone(doc),c=new OffscreenCanvas(800,600),ctx=c.getContext('2d'),view={reference:{width:800,height:600},transform:[1,0,0,1,0,0]},pending=m.drawLayerStack(ctx,doc,view);doc.layers[1].paint.color='#0000ff';await pending;const first=ctx.getImageData(0,0,800,600).data,allRed=first.every((v,i)=>v===[255,0,0,255][i%4]);ctx.clearRect(0,0,800,600);frozen.layers.reverse();await m.drawLayerStack(ctx,frozen,view);const second=ctx.getImageData(0,0,800,600).data;return {allRed,white:second.filter((v,i)=>i%4===1&&v>200).length};});expect(result.allRed).toBe(true);expect(result.white).toBeGreaterThan(1000);
});
