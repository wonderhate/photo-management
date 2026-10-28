import {expect} from '@playwright/test';
import {invertCube} from './lut-ui.mjs';
export async function exerciseLutWorker(page,module,document){
  const result=await page.evaluate(async({module,document,cube})=>{
    const services=(await import(module)).createEditorServices(),asset=await services.library.importLut(new File([cube],'Worker.cube')),session=services.render.session(),w=1001,h=257,c=new OffscreenCanvas(w,h),ctx=c.getContext('2d');ctx.fillStyle='#245067';ctx.fillRect(0,0,w,h);const file=new File([await c.convertToBlob({type:'image/png'})],'lut-worker.png'),hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].join(','),before=await hash(file);
    const pixels=async blob=>{const b=await createImageBitmap(blob),c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);b.close();return x.getImageData(0,0,c.width,c.height).data;};
    const neutral={version:1,exposure:0,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:0,y:0,width:1,height:1},sharpen:0,denoise:0,match:0,preserveLuminance:true};
    const recipe={...neutral,version:5,composition:{source_width:w,source_height:h,angle:0},layer_stack:{version:1,layers:[]},lut:{version:1,asset_hash:asset.id,strength:1,input:'srgb'}};
    try{
      await session.open(file,{version:2,extra_orientation:1});const plain=await pixels((await session.export(recipe,0,'png',95)).blob),sample=Array.from(plain.slice(0,4));
      recipe.layer_stack=document;document.layers[0].coverage=.5;document.layers[0].edge='bottom';document.layers[0].paint={kind:'solid',color:'#ff0000',opacity:1};document.layers[0].opacity=1;document.layers[1].text='LUT 光影';
      const preview=await session.render(recipe),output=await session.export(recipe,0,'png',95),image=await pixels(output.blob),bottom=Array.from(image.slice(-4));
      const spec={version:1,aspect:{width:w/(3*h)*10,height:10},count:3,region:{x:0,y:0,width:1,height:1},basis:{width:w,height:h},angle:0},split=await session.split(recipe,spec,'png',95),master=await pixels(split.master.blob),joined=new Uint8ClampedArray(master.length);
      for(const panel of split.panels){const p=await pixels(panel.blob),rect=split.plan.panels[panel.index];for(let y=0;y<h;y++)joined.set(p.subarray(y*rect.width*4,(y+1)*rect.width*4),(y*w+rect.x)*4);}
      const cropped=structuredClone(recipe);cropped.crop={x:.25,y:.35,width:.5,height:.3};cropped.composition.angle=7;const cs={...spec,angle:7,region:{x:.15,y:.3,width:.7,height:.4},aspect:{width:(.7*w/(3*.4*h))*10,height:10}},cross=await session.split(cropped,cs,'png',95),mapped=await session.render(cross.recipe,cropped);
      const record=await services.library.save(file,recipe,null,undefined,{version:2,extra_orientation:1}),group=await services.library.saveSplit(record,split,file.name,crypto.randomUUID());await services.library.updateLut(asset.id,{hidden:true});const reopened=await services.library.getRecord(record.id),other=services.render.session();let restored;
      try{await other.open(await services.library.source(reopened),reopened.decode_profile);restored=await hash((await other.export(reopened.recipe,0,'png',95)).blob)===await hash(output.blob);}finally{other.dispose();}
      const child=await services.library.createSplitEdit(group.id,group.panels[1].id,crypto.randomUUID());await session.open(await services.library.source(child),child.decode_profile);const childPixels=await pixels((await session.export(child.recipe,0,'png',95)).blob),panel=await pixels(split.panels[1].blob);
      return {sample,bottom,preview:await hash(preview.blob)===await hash(output.blob),master:await hash(split.master.blob)===await hash(output.blob),seams:master.every((v,i)=>v===joined[i]),mapped:await hash(mapped.blob)===await hash(cross.master.blob),restored,neutral:childPixels.every((v,i)=>v===panel[i]),frozen:JSON.stringify(group.parent_recipe)===JSON.stringify(recipe),original:await hash(file)===before,recordId:record.id,asset};
    }finally{session.dispose();}
  },{module,document,cube:invertCube('Worker')});
  expect(result).toMatchObject({sample:[219,175,152,255],bottom:[255,0,0,255],preview:true,master:true,seams:true,mapped:true,restored:true,neutral:true,frozen:true,original:true});return result;
}
