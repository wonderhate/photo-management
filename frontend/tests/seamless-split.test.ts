import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {cropCenter,cropCorners,compositionBasis} from '../src/core/composition-geometry.ts';
import {createSplit,resolveSplitCount,reshapeSplit,resetSplitRegion,moveSplit,resizeSplit,panelBoundaries,splitPlan,validateSplit,validateSplitAspect} from '../src/core/seamless-split.ts';
import type {SplitSpec,SplitCorner} from '../src/core/seamless-split.ts';
import {renderSplitPixels,splitPixelPanels,splitRecipe} from '../src/core/split-render.ts';
import {neutralRecipe,renderPixels} from '../src/browser/editing.ts';
import type {Pixels,EditRecipe} from '../src/browser/editing.ts';
import {straightenRecipe} from '../src/core/composition-recipe.ts';

const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(width=77,height=53,kind:'u8'|'clamped'|'linear16'='clamped'):Pixels{
  const channels=kind==='linear16'?3:4,length=width*height*channels,data=kind==='linear16'?new Uint16Array(length):kind==='u8'?new Uint8Array(length):new Uint8ClampedArray(length),mod=kind==='linear16'?65536:256;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<channels;c++)data[(y*width+x)*channels+c]=(x*37+y*13+c*51)%mod;
  return {width,height,channels,data,...(kind==='linear16'?{linear:true}:{})};
}
function join(p:Pixels,plan:ReturnType<typeof splitPlan>){
  const output=new Uint8ClampedArray(p.width*p.height*p.channels);let count=0;
  for(const piece of splitPixelPanels(p,plan)){
    const {rect,pixels}=piece;for(let y=0;y<p.height;y++)output.set(pixels.data.subarray(y*rect.width*p.channels,(y+1)*rect.width*p.channels),(y*p.width+rect.x)*p.channels);count++;
  }
  assert.equal(count,plan.count);return output;
}
function validBounds(s:SplitSpec){validateSplit(s);for(const p of cropCorners(s.region,s.basis,s.angle))assert.ok(p.x>=-1e-9&&p.x<=1+1e-9&&p.y>=-1e-9&&p.y<=1+1e-9);}

test('split auto/manual counts, presets and custom aspect keep their meaning across region changes',()=>{
  const spec=createSplit({width:2400,height:800});assert.deepEqual(spec.aspect,{width:3,height:4});assert.equal(spec.count,null);assert.equal(resolveSplitCount(spec.basis,spec.aspect,spec.count),4);assert.deepEqual(spec.region,{x:0,y:0,width:1,height:1});
  const manual=reshapeSplit(spec,spec.aspect,3);close(manual.region.x,.125);close(manual.region.width,.75);close(manual.region.height,1);
  const square=reshapeSplit(manual,{width:1,height:1});assert.equal(square.count,3);close(square.region.width,1);close(square.region.height,1);
  const custom=reshapeSplit(square,{width:2,height:1});close(custom.region.width,1);close(custom.region.height,.5);assert.equal(custom.count,3);
  const automatic=reshapeSplit(custom,custom.aspect,null);assert.equal(automatic.count,null);assert.equal(resolveSplitCount(automatic.basis,automatic.aspect),2);
  assert.equal(resolveSplitCount({width:10000,height:2},{width:1,height:1}),10);assert.equal(resolveSplitCount({width:2,height:10000},{width:1,height:1}),2);
  const original=JSON.stringify(spec);moveSplit(manual,{x:.03,y:0});assert.equal(JSON.stringify(spec),original);assert.deepEqual(resetSplitRegion(moveSplit(manual,{x:.03,y:0})),manual);
});

test('cumulative integer edges cover every column once even when panel widths cannot be equal',()=>{
  const contract=JSON.parse(readFileSync(new URL('./fixtures/split-contract.json',import.meta.url),'utf8'));
  for(const {width,count,edges} of contract.boundaries)assert.deepEqual(panelBoundaries(width,count),edges);
  for(const width of [2,3,7,13,101,1001,4093,65535,100_000_000])for(let n=2;n<=10;n++){
    if(width<n){assert.throws(()=>panelBoundaries(width,n));continue;}
    const b=panelBoundaries(width,n),widths=b.slice(1).map((v,i)=>v-b[i]);assert.equal(b[0],0);assert.equal(b[n],width);assert.equal(widths.reduce((a,v)=>a+v,0),width);assert.ok(Math.min(...widths)>=1);assert.ok(Math.max(...widths)-Math.min(...widths)<=1);
    if(width<5000){const seen=new Uint8Array(width);for(let i=0;i<n;i++)for(let x=b[i];x<b[i+1];x++)seen[x]++;assert.ok(seen.every(v=>v===1));}
  }
  assert.throws(()=>splitPlan(createSplit({width:1,height:1})),/at least one pixel/);
});

test('four split corners keep the opposite anchor and locked aspect, with rotated bounds and source-space movement',()=>{
  for(const angle of [-45,-17,0,23,45])for(const corner of ['nw','ne','se','sw'] as SplitCorner[]){
    const max=createSplit({width:1001,height:677},angle,{width:3,height:4},3),c=cropCenter(max.region),spec={...max,region:{x:c.x-max.region.width*.3,y:c.y-max.region.height*.3,width:max.region.width*.6,height:max.region.height*.6}},r=spec.region;
    const ax=r.x+(corner.includes('w')?r.width:0),ay=r.y+(corner.includes('n')?r.height:0),small=resizeSplit(spec,corner,cropCenter(r)),sr=small.region;
    close(sr.width,r.width/2);close(sr.height,r.height/2);close(sr.x+(corner.includes('w')?sr.width:0),ax);close(sr.y+(corner.includes('n')?sr.height:0),ay);validBounds(small);
    const huge=resizeSplit(spec,corner,{x:corner.includes('w')?-100:100,y:corner.includes('n')?-100:100}),hr=huge.region;
    close(hr.x+(corner.includes('w')?hr.width:0),ax);close(hr.y+(corner.includes('n')?hr.height:0),ay);validBounds(huge);
    for(const delta of [{x:20,y:-20},{x:-20,y:20}]){const moved=moveSplit(small,delta);validBounds(moved);close(moved.region.width,sr.width);close(moved.region.height,sr.height);}
  }
  const wide=createSplit({width:101,height:101},45,{width:5,height:1},2);assert.ok(wide.region.x<0&&wide.region.x+wide.region.width>1);validBounds(wide);validBounds(resizeSplit(wide,'se',{x:.7,y:.6}));
});

test('split schema rejects future, mislabeled, nonfinite, mismatched aspect and unsafe dimensions without mutating its input',()=>{
  const s=createSplit({width:401,height:277},12);for(const patch of [{version:2},{count:1},{count:11},{count:2.5},{count:undefined},{count:true},{angle:NaN},{angle:46},{angle:null},{unexpected:1},{basis:{width:1,height:100_000_001}},{region:{...s.region,width:s.region.width*.9}},{region:{...s.region,x:100}}])assert.throws(()=>validateSplit({...s,...patch}));
  for(const aspect of [{width:0,height:1},{width:101,height:1},{width:1,height:Infinity},{width:1,height:1,unknown:1},[1,1],null])assert.throws(()=>validateSplitAspect(aspect));
  validateSplitAspect({width:1.25,height:2.5});assert.throws(()=>createSplit({width:1.5,height:2}));assert.throws(()=>panelBoundaries(10,2.5));assert.throws(()=>panelBoundaries(Infinity,2));assert.throws(()=>resizeSplit(s,'n' as SplitCorner,{x:0,y:0}));
  const before=JSON.stringify(s);reshapeSplit(s,{width:4,height:5});resizeSplit(s,'nw',{x:.4,y:.4});assert.equal(JSON.stringify(s),before);
});

test('ordered pixel panels preserve 8/16-bit values, alpha and all odd-width columns; damaged late edges fail before the first yield',()=>{
  for(const kind of ['u8','clamped','linear16'] as const){
    const p=fixture(1001,7,kind),before=p.data.slice(),spec=createSplit(p,0,{width:1001/21,height:1},3),plan=splitPlan(spec);assert.equal(plan.width,1001);assert.equal(plan.height,7);
    const out=p.data.slice();out.fill(0);for(const {index,rect,pixels} of splitPixelPanels(p,plan)){
      assert.equal(rect.x,plan.edges[index]);assert.equal(pixels.linear,p.linear);assert.equal(pixels.data.constructor,p.data.constructor);
      for(let y=0;y<p.height;y++)out.set(pixels.data.subarray(y*rect.width*p.channels,(y+1)*rect.width*p.channels),(y*p.width+rect.x)*p.channels);
    }
    assert.deepEqual(out,before);assert.deepEqual(p.data,before);
    const broken=structuredClone(plan);broken.panels.at(-1)!.x++;assert.throws(()=>splitPixelPanels(p,broken).next());
    const uneven=structuredClone(plan);uneven.edges[1]++;uneven.panels[0].width++;uneven.panels[1].width--;uneven.panels[1].x++;assert.throws(()=>splitPixelPanels(p,uneven).next());
    assert.throws(()=>splitPixelPanels({...p,data:p.data.subarray(1)},plan).next());
  }
});

test('render once then slice reproduces the complete edited frame through free angles, turns, flips and 16-bit color without changing sources',()=>{
  for(const kind of ['clamped','linear16'] as const){const p=fixture(77,53,kind),before=createHash('sha256').update(p.data).digest('hex');
    for(const rotation of [0,90,180,270] as const)for(const angle of [-22,0,19]){
      const base=straightenRecipe({...neutralRecipe(),rotation,flipX:true,flipY:rotation===180,exposure:.5,contrast:9,temperature:11,sharpen:60,denoise:35},p,angle),spec=createSplit(compositionBasis(p,rotation),angle,{width:3,height:4},3);
      const result=renderSplitPixels(p,base,spec);assert.deepEqual(join(result.pixels,result.plan),renderPixels(p,splitRecipe(base,p,spec)).data);
      const other:EditRecipe={...base,crop:{x:.4,y:.4,width:.1,height:.1}};assert.deepEqual(renderSplitPixels(p,other,spec).pixels.data,result.pixels.data);
      assert.throws(()=>splitRecipe(base,p,{...spec,basis:{width:spec.basis.width+1,height:spec.basis.height}}));
    }
    assert.equal(createHash('sha256').update(p.data).digest('hex'),before);
  }
  assert.throws(()=>splitRecipe(neutralRecipe(),{width:77,height:53},createSplit({width:77,height:53},3)),/angle changed/);
});

test('per-panel denoise/sharpen changes seam pixels, while slicing a shared full render keeps the original neighborhood',()=>{
  const p=fixture(101,67),recipe={...neutralRecipe(),sharpen:85,denoise:45},spec=createSplit(p,0,{width:1,height:1},3),{pixels,plan,recipe:frozen}=renderSplitPixels(p,recipe,spec);
  assert.deepEqual(join(pixels,plan),pixels.data);let changed=0;
  for(const rect of plan.panels){
    const naive={...frozen,crop:{...frozen.crop,x:frozen.crop.x+rect.x/plan.width*frozen.crop.width,width:rect.width/plan.width*frozen.crop.width},composition:{...frozen.composition,aspect:frozen.composition.aspect!*rect.width/plan.width}},part=renderPixels(p,naive);
    assert.equal(part.width,rect.width);assert.equal(part.height,rect.height);
    for(let y=0;y<part.height;y++)for(const x of [0,part.width-1])for(let c=0;c<3;c++)if(part.data[(y*part.width+x)*4+c]!==pixels.data[(y*plan.width+rect.x+x)*4+c])changed++;
  }
  assert.ok(changed>0,'Fixture must detect separate spatial processing at the seams.');
});
