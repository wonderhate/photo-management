export async function prepareLinkedSplit(page,module,photoID){
  return page.evaluate(async({module,photoID})=>{
    const services=(await import(module)).createEditorServices(),loaded=await services.library.photo(photoID),file=new File([await loaded.file.arrayBuffer()],loaded.file.name,{type:loaded.file.type});
    const session=services.render.session(),recipe={version:1,exposure:.2,contrast:0,highlights:0,shadows:0,temperature:0,tint:0,saturation:0,hue:0,hslSaturation:0,lightness:0,curve:[0,.25,.5,.75,1],rotation:0,flipX:false,flipY:false,crop:{x:.1,y:.1,width:.8,height:.8},sharpen:10,denoise:10,match:0,preserveLuminance:true};
    const spec={version:1,aspect:{width:3,height:4},count:2,region:{x:0,y:0,width:1,height:1},basis:{width:1200,height:800},angle:0},profile=loaded.photo.decode_profile;
    try{
      await session.open(file,profile);const result=await session.split(recipe,spec,'png',95),record=await services.library.save(file,recipe,photoID,undefined,profile),request=crypto.randomUUID();
      window.__linkedSplit={services,file,recipe,spec,profile,record,result,request,photoID};
      return {record,request,hashes:result.panels.map(p=>p.sha256)};
    }finally{session.dispose();}
  },{module,photoID});
}
