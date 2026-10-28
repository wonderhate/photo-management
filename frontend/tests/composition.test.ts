import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {neutralRecipe,renderPixels,validateRecipe} from '../src/browser/editing.ts';
import type {Pixels,EditRecipeV2} from '../src/browser/editing.ts';
import {compositionBasis,cropCorners,cropCenter,fitCrop,cropForAspect,moveCrop,resizeCrop,validateComposition} from '../src/core/composition-geometry.ts';
import type {CropHandle} from '../src/core/composition-geometry.ts';
import {composeRecipe,straightenRecipe,aspectRecipe,turnRecipe,flipRecipe,compositionBase,compositionZoom,compositionView,zoomRecipe,trackCompositionView} from '../src/core/composition-recipe.ts';

function pixels(linear=false):Pixels{
  const width=17,height=11,channels=linear?3:4,data=linear?new Uint16Array(width*height*channels):new Uint8ClampedArray(width*height*channels);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<channels;c++)data[(y*width+x)*channels+c]=c===3?80+(x*13+y*7)%176:(x*251+y*113+c*4321)%(linear?65536:256);
  return {width,height,channels,data,linear};
}

test('96 saved v1 golden renders remain byte identical across color, crop, turns, flips, 16-bit and output edges',()=>{
  const hash=createHash('sha256');
  for(const linear of [false,true]){
    const p=pixels(linear),original=p.data.slice();
    for(const rotation of [0,90,180,270] as const)for(const flipX of [false,true])for(const flipY of [false,true])for(const edge of [0,9,200]){
      const r={...neutralRecipe(),rotation,flipX,flipY,crop:{x:.13,y:.17,width:.71,height:.79},exposure:.6,contrast:17,highlights:-11,shadows:21,temperature:8,tint:-4,saturation:13,hue:7,hslSaturation:9,lightness:-3,curve:[0,.21,.48,.8,1],sharpen:15,denoise:7,reference:{mean:[55,7,-4],std:[22,6,11]},match:23,preserveLuminance:false};
      const q=renderPixels(p,r,edge);hash.update(`${q.width}x${q.height}:`);hash.update(q.data);assert.deepEqual(p.data,original);
      const v2=renderPixels(p,composeRecipe(r,p),edge);assert.deepEqual(v2,q);
    }
  }
  // Captured from the unmodified v1 kernel before adding composition v2.
  assert.equal(hash.digest('hex'),'8e310fbaad9c5022b7606bbfa4ce196f268ba3d56c7510a17e43bf0f16beb391');
});

test('free angles select independently calculated source pixel centers through turns and flips',()=>{
  const width=257,height=181,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([Math.min(255,x),y,44,255],(y*width+x)*4);
  const p:Pixels={width,height,channels:4,data},original=data.slice();
  for(const angle of [-45,-17,0,12,45])for(const rotation of [0,90,180,270] as const)for(const flipX of [false,true])for(const flipY of [false,true]){
    const r=straightenRecipe({...neutralRecipe(),rotation,flipX,flipY,crop:{x:.13,y:.21,width:.54,height:.56}},p,angle),q=renderPixels(p,r);
    const W=rotation===90||rotation===270?height:width,H=rotation===90||rotation===270?width:height,cx=r.crop.x+r.crop.width/2,cy=r.crop.y+r.crop.height/2,a=angle*Math.PI/180;
    for(const [x,y] of [[0,0],[q.width-1,0],[q.width-1,q.height-1],[0,q.height-1],[Math.floor(q.width/2),Math.floor(q.height/2)]]){
      const dx=((x+.5)/q.width-.5)*r.crop.width*W,dy=((y+.5)/q.height-.5)*r.crop.height*H;
      let u=cx+(Math.cos(a)*dx+Math.sin(a)*dy)/W,v=cy+(-Math.sin(a)*dx+Math.cos(a)*dy)/H;
      if(flipX)u=1-u;if(flipY)v=1-v;
      [u,v]=rotation===90?[v,1-u]:rotation===180?[1-u,1-v]:rotation===270?[1-v,u]:[u,v];
      const at=(y*q.width+x)*4;assert.ok(Math.abs(q.data[at]-Math.max(0,Math.min(255,u*width-.5)))<=.51);assert.ok(Math.abs(q.data[at+1]-Math.max(0,Math.min(height-1,v*height-.5)))<=.51);assert.equal(q.data[at+3],255);
    }
  }
  assert.deepEqual(data,original);
});

test('a valid wide rotated rectangle may extend outside the unrotated source box',()=>{
  const p:Pixels={width:101,height:101,channels:4,data:new Uint8ClampedArray(101*101*4).fill(255)},r:EditRecipeV2={...neutralRecipe(),version:2,crop:{x:-.1,y:.45,width:1.2,height:.1},composition:{source_width:101,source_height:101,angle:45,aspect:12}};
  validateRecipe(r);assert.throws(()=>validateRecipe({...neutralRecipe(),crop:r.crop}));
  const q=renderPixels(p,r);assert.equal(q.width,121);assert.equal(q.height,10);assert.ok([...q.data].every(v=>v===255));
  for(const point of cropCorners(r.crop,p,45))assert.ok(point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1);
});

test('eight center resize handles, translation, aspect fit and straightening stay inside actual rotated source corners',()=>{
  for(const size of [{width:503,height:277},{width:277,height:503},{width:101,height:101}])for(const angle of [-45,-19,0,31,45])for(const aspect of [undefined,1,3/2,9/16]){
    const initial=fitCrop({x:.1,y:.15,width:.7,height:.6},size,angle),crop=aspect?cropForAspect(initial,size,angle,aspect):initial,g={source_width:size.width,source_height:size.height,angle,...(aspect?{aspect}:{})};
    validateComposition(g,crop,0);
    const moved=moveCrop(crop,size,angle,{x:4,y:-3});validateComposition(g,moved,0);
    for(const handle of ['n','ne','e','se','s','sw','w','nw'] as CropHandle[]){const q=resizeCrop(crop,size,angle,handle,{x:5,y:-4},aspect);validateComposition(g,q,0);assert.ok(Math.abs(cropCenter(q).x-cropCenter(crop).x)<1e-12);assert.ok(Math.abs(cropCenter(q).y-cropCenter(crop).y)<1e-12);}
  }
});

test('v2 quarter turns and mirrors preserve the selected pixels and their locked aspect',()=>{
  const p=pixels(),r=aspectRecipe(straightenRecipe(neutralRecipe(),p,23),p,3/2),base=renderPixels(p,r),turned=turnRecipe(r);validateRecipe(turned);
  const q=renderPixels(p,turned);assert.equal(q.width,base.height);assert.equal(q.height,base.width);
  for(let y=0;y<q.height;y++)for(let x=0;x<q.width;x++)for(let c=0;c<4;c++)assert.ok(Math.abs(q.data[(y*q.width+x)*4+c]-base.data[((base.height-1-x)*base.width+y)*4+c])<=1);
  for(const axis of ['x','y'] as const){const next=flipRecipe(r,axis);validateRecipe(next);const flipped=renderPixels(p,next);assert.equal(flipped.width,base.width);assert.equal(flipped.height,base.height);for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++)for(let c=0;c<4;c++)assert.ok(Math.abs(flipped.data[(y*base.width+x)*4+c]-base.data[((axis==='y'?base.height-1-y:y)*base.width+(axis==='x'?base.width-1-x:x))*4+c])<=1);}
  const previewBase=compositionBase(r);validateRecipe(previewBase);assert.equal(previewBase.version,1);assert.ok(!('composition' in previewBase));
});

test('unknown or mislabeled recipes, invalid bounds and a changed decoded source fail before sampling',()=>{
  const p=pixels(),r=straightenRecipe(neutralRecipe(),p,20);
  for(const invalid of [{...r,version:3},{...r,version:1},{...r,composition:{...r.composition,angle:46}},{...r,composition:{...r.composition,angle:NaN}},{...r,composition:{...r.composition,source_width:true}},{...r,composition:{...r.composition,extra:1}},{...r,composition:{...r.composition,aspect:null}},{...r,composition:{...r.composition,aspect:7}},{...r,crop:{x:-9,y:0,width:.1,height:.1}},{...r,crop:{...r.crop,width:Infinity}}])assert.throws(()=>validateRecipe(invalid));
  const small=composeRecipe({...neutralRecipe(),crop:{x:.25,y:.25,width:.5,height:.5}},p);
  assert.throws(()=>renderPixels(p,{...small,composition:{...small.composition,source_width:18}}),/source dimensions changed/);
  assert.deepEqual(compositionBasis(p,90),{width:p.height,height:p.width});
  assert.throws(()=>validateRecipe({...r,crop:{x:Number.MAX_VALUE,y:Number.MAX_VALUE,width:Number.MAX_VALUE,height:Number.MAX_VALUE}}));
});

test('crop zoom covers the twenty-fold source scale, clamps panning and keeps the frame in place',()=>{
  const source={width:640,height:480};
  for(const angle of [-45,0,23])for(const ratio of [1,3/2,2.35]){
    const base=aspectRecipe(straightenRecipe(neutralRecipe(),source,angle),source,ratio),view=compositionView(base,source);
    for(const zoom of [1,1.01,2,20]){const next=zoomRecipe(base,source,zoom);validateRecipe(next);assert.ok(Math.abs(compositionZoom(next,source)-zoom)<1e-9);const camera=trackCompositionView(base,next,view);assert.ok(Math.abs(base.crop.width*view.scale-next.crop.width*camera.scale)<1e-9);assert.ok(Math.abs(base.crop.height*view.scale-next.crop.height*camera.scale)<1e-9);}
    const small=zoomRecipe(base,source,20),size=compositionBasis(source,base.rotation),panned={...small,crop:moveCrop(small.crop,size,angle,{x:2,y:2})},out=zoomRecipe(panned,source,1);validateRecipe(out);assert.ok(Math.abs(compositionZoom(out,source)-1)<1e-9);
  }
  assert.throws(()=>zoomRecipe(neutralRecipe(),source,0));
});

test('counterclockwise rotation retains the same selected pixels and round trips through clockwise rotation',()=>{
  const p=pixels(),r=straightenRecipe(neutralRecipe(),p,19),base=renderPixels(p,r),left=turnRecipe(r,-1),q=renderPixels(p,left);validateRecipe(left);assert.equal(q.width,base.height);assert.equal(q.height,base.width);
  for(let y=0;y<q.height;y++)for(let x=0;x<q.width;x++)for(let c=0;c<4;c++)assert.ok(Math.abs(q.data[(y*q.width+x)*4+c]-base.data[(x*base.width+base.width-1-y)*4+c])<=1);
  const restored=renderPixels(p,turnRecipe(left));assert.equal(restored.width,base.width);assert.equal(restored.height,base.height);for(let i=0;i<base.data.length;i++)assert.ok(Math.abs(restored.data[i]-base.data[i])<=1);
});
