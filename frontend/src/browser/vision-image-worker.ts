import {VISION_MAX_BYTES,VISION_MAX_PIXELS} from '../core/vision-assets';
self.onmessage=async({data}:{data:{file:File}})=>{
  let image:ImageBitmap|undefined,canvas:OffscreenCanvas|undefined;
  try{
    const file=data.file;if(!file||file.size>VISION_MAX_BYTES||file.size<33)throw new Error('Use a non-animated transparent PNG within 16 megapixels.');
    const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer),signature=[137,80,78,71,13,10,26,10];
    if(signature.some((v,i)=>bytes[i]!==v)||view.getUint32(8)!==13||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new Error('Use a non-animated transparent PNG within 16 megapixels.');
    const width=view.getUint32(16),height=view.getUint32(20);if(!width||!height||width>8192||height>8192||width*height>VISION_MAX_PIXELS)throw new Error('Use a non-animated transparent PNG within 16 megapixels.');
    for(let at=8;at<bytes.length;){if(at+12>bytes.length)throw new Error('Invalid local vision asset.');const size=view.getUint32(at),kind=String.fromCharCode(...bytes.slice(at+4,at+8));if(size>bytes.length-at-12||kind==='acTL')throw new Error('Use a non-animated transparent PNG within 16 megapixels.');at+=size+12;}
    image=await createImageBitmap(file);canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,width,height).data;
    let transparent=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]<255){transparent=true;break;}if(!transparent)throw new Error('Use a non-animated transparent PNG within 16 megapixels.');
    const blob=await canvas.convertToBlob({type:'image/png'});if(blob.size>VISION_MAX_BYTES)throw new Error('Local vision asset exceeds the size limit.');self.postMessage({blob,width,height});
  }catch(e){self.postMessage({error:e instanceof Error?e.message:'Local vision request failed.'});}
  finally{image?.close();if(canvas)canvas.width=1;}
};
