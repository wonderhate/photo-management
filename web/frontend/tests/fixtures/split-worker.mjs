import {expect} from '@playwright/test';

export async function exerciseSplitWorker(page,module,saveNative=false){
  const result=await page.evaluate(async({module,saveNative})=>{
    const services=await(await import(module)).createEditorServices(),session=services.render.session();
    const width=1001,height=137,canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d'),input=ctx.createImageData(width,height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)input.data.set([Math.round(200*x/width),Math.round(200*y/height),Math.round(120+20*Math.sin(x/30)),64+(x+y)%192],(y*width+x)*4);
    ctx.putImageData(input,0,0);const file=new File([await canvas.convertToBlob({type:'image/png'})],'split-synthetic.png',{type:'image/png'});
    const hash=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const sourceHash=await hash(file),profile={version:2,extra_orientation:1};
    const pixels=async blob=>{const bitmap=await createImageBitmap(blob),c=new OffscreenCanvas(bitmap.width,bitmap.height),context=c.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return {width:c.width,height:c.height,data:context.getImageData(0,0,c.width,c.height).data};};
    const recipe={version:1,exposure:.2,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:.1,y:.1,width:.8,height:.8},sharpen:45,denoise:20,match:0,preserveLuminance:true};
    const spec={version:1,aspect:{width:1001/(3*137)*10,height:10},count:3,region:{x:0,y:0,width:1,height:1},basis:{width,height},angle:0};
    const check=async output=>{
      const full=await pixels(output.master.blob),joined=new Uint8ClampedArray(full.data.length),hashes=[await hash(output.master.blob)===output.master.sha256];let jpegError=0,jpegSamples=0;
      for(const p of output.panels){
        const part=await pixels(p.blob),rect=output.plan.panels[p.index];if(part.width!==rect.width||part.height!==rect.height)throw new Error('Wrong encoded panel dimensions.');
        hashes.push(await hash(p.blob)===p.sha256);
        for(let y=0;y<part.height;y++){
          joined.set(part.data.subarray(y*part.width*4,(y+1)*part.width*4),(y*full.width+rect.x)*4);
          if(output.format==='jpg')for(let x=0;x<part.width;x++)for(let c=0;c<3;c++){const a=(y*full.width+rect.x+x)*4,expected=(full.data[a+c]*full.data[a+3]+255*(255-full.data[a+3]))/255;jpegError+=Math.abs(part.data[(y*part.width+x)*4+c]-expected);jpegSamples++;}
        }
      }
      return {hashes,diff:joined.reduce((n,v,i)=>n+(v!==full.data[i]?1:0),0),jpegMean:jpegError/(jpegSamples||1),dimensions:[full.width,full.height],edges:output.plan.edges};
    };
    try{
      await session.open(file,profile);const progress=[],mutableRecipe=structuredClone(recipe),mutableSpec=structuredClone(spec);
      const pending=session.split(mutableRecipe,mutableSpec,'png',93,value=>progress.push(value));mutableRecipe.exposure=99;mutableSpec.count=10;
      const png=await pending,pngCheck=await check(png),same=await session.export(png.recipe,0,'png',93);
      const turned={...recipe,version:2,rotation:90,flipX:true,crop:{x:.4,y:.4,width:.1,height:.1},composition:{source_width:width,source_height:height,angle:17}};
      const rotatedSpec={version:1,aspect:{width:1,height:((height*.4)/(width*.1)/3)**-1},count:3,region:{x:.3,y:.45,width:.4,height:.1},basis:{width:height,height:width},angle:17};
      const rotated=await session.split(turned,rotatedSpec,'png',93),rotatedCheck=await check(rotated),jpeg=await session.split(turned,rotatedSpec,'jpg',93),jpegCheck=await check(jpeg);
      let saved=null;
      if(saveNative){
        const record=await services.library.save(file,recipe,null,undefined,profile),request=crypto.randomUUID();
        window.__splitFixture={file,recipe,spec,profile,record,result:png,request};
        const group=await services.library.saveSplit(record,png,file.name,request),again=await services.library.saveSplit(record,png,file.name,request),restored=await services.library.splitGroup(group.id),stored=[];
        for(const p of restored.panels)stored.push(await hash(await(await fetch(p.preview_url)).blob()));
        const source=await services.library.source(record);saved={id:group.id,retry:again.id,plan:restored.plan,parent:restored.parent_recipe,sourceHash:await hash(source),stored,expected:png.panels.map(p=>p.sha256),master:restored.master,panels:restored.panels};
      }
      const invalid=[];for(const [s,format,quality] of [[{...spec,basis:{width:width+1,height}},'png',93],[spec,'webp',93],[spec,'png',NaN]]){try{await session.split(recipe,s,format,quality);invalid.push('unexpected success');}catch(e){invalid.push(e.message);}}
      const recovered=await session.render(recipe);let cancelledProgress=0;
      const cancelled=session.split(recipe,spec,'png',93,()=>{cancelledProgress++;session.dispose();});
      const queued=session.render(recipe),outcomes=await Promise.allSettled([cancelled,queued]);
      const fresh=services.render.session();let reopened;try{reopened=await fresh.open(file,profile);}finally{fresh.dispose();}
      return {png:pngCheck,rotated:rotatedCheck,jpeg:jpegCheck,progress,same:await hash(same.blob)===png.master.sha256,saved,invalid,recovered:recovered.width>0,cancelledProgress,cancelled:outcomes.map(o=>o.status==='rejected'&&o.reason.message.includes('cancelled')),reopened:[reopened.width,reopened.height],before:sourceHash,after:await hash(file)};
    }finally{session.dispose();}
  },{module,saveNative});
  expect(result.png.dimensions).toEqual([1001,137]);expect(result.png.edges).toEqual([0,334,667,1001]);expect(result.png.diff).toBe(0);expect(result.rotated.diff).toBe(0);
  for(const part of [result.png,result.rotated,result.jpeg])expect(part.hashes.every(Boolean)).toBe(true);
  expect(result.rotated.dimensions).toEqual([55,100]);expect(result.jpeg.dimensions).toEqual(result.rotated.dimensions);expect(result.jpeg.jpegMean).toBeLessThan(8);
  expect(result.same).toBe(true);expect(result.progress.map(p=>[p.phase,p.done,p.total])).toEqual([['render',0,3],['encode',0,3],['encode',1,3],['encode',2,3],['encode',3,3]]);
  expect(result.before).toBe(result.after);expect(result.invalid).toHaveLength(3);expect(result.invalid).not.toContain('unexpected success');expect(result.recovered).toBe(true);expect(result.cancelledProgress).toBe(1);expect(result.cancelled).toEqual([true,true]);expect(result.reopened).toEqual([1001,137]);
  if(saveNative){expect(result.saved.id).toBe(result.saved.retry);expect(result.saved.stored).toEqual(result.saved.expected);expect(result.saved.sourceHash).toBe(result.before);expect(result.saved.plan.edges).toEqual(result.png.edges);expect(result.saved.parent.crop).toEqual({x:.1,y:.1,width:.8,height:.8});expect(result.saved.panels).toHaveLength(3);}
  return result;
}
