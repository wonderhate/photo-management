import {env,pipeline,SamModel,SamProcessor,RawImage} from '@huggingface/transformers';
import wasmURL from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import wasmModuleURL from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import {validateVisionRequest} from '../core/local-vision';
import type {VisionRequest} from '../core/local-vision';
env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;env.useWasmCache=false;
if(env.backends.onnx.wasm){env.backends.onnx.wasm.wasmPaths={wasm:wasmURL,mjs:wasmModuleURL};env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;}
// This worker receives only a checked offline package and an image Blob. Never
// accept a user URL or let a missing model fall through to the network.
self.onmessage=async({data}:{data:{payload:VisionRequest;image:Blob;files:{name:string;blob:Blob}[]}})=>{
  try{
    const {payload,files}=data,spec=validateVisionRequest(payload,'browser');
    env.customCache={async match(request){const expected=spec.files.find(f=>request.endsWith('/'+f.name));if(!expected)return new Response(null,{status:404});const file=files.find(f=>f.name===expected.name);if(!file||file.blob.size!==expected.bytes)return new Response(null,{status:404});return new Response(file.blob,{headers:{'Content-Type':expected.name.endsWith('.json')?'application/json':'application/octet-stream','Content-Length':String(file.blob.size)}});},async put(){throw new Error('Local vision models are read-only.');}};
    let image=await RawImage.fromBlob(data.image);if(image.width*image.height>16_777_216||Math.abs(image.width*payload.source.height-image.height*payload.source.width)>Math.max(payload.source.width,payload.source.height))throw new Error('Invalid local vision input.');const scale=Math.min(1,2048/Math.max(image.width,image.height));if(scale<1)image=await image.resize(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));image=image.rgb();
    const items:{blob:Blob;width:number;height:number;instance_id:string|null}[]=[];
    if(payload.kind==='depth'){
      const model=await pipeline('depth-estimation',spec.repo,{revision:spec.revision,device:'wasm',dtype:'q8',local_files_only:true});
      try{const output=await model(image),tensor=output.predicted_depth,values=tensor.data;let min=Infinity,max=-Infinity;for(const v of values){const n=Number(v);if(!Number.isFinite(n))throw new Error('Invalid local vision output.');min=Math.min(min,n);max=Math.max(max,n);}const bytes=new Uint8Array(values.length);for(let i=0;i<values.length;i++)bytes[i]=Math.round(255*(Number(values[i])-min)/Math.max(1e-12,max-min));const gray=await new RawImage(bytes,tensor.dims.at(-1)!,tensor.dims.at(-2)!,1).resize(image.width,image.height),canvas=gray.toCanvas() as OffscreenCanvas;try{items.push({blob:await canvas.convertToBlob({type:'image/png'}),width:canvas.width,height:canvas.height,instance_id:null});}finally{canvas.width=1;}}
      finally{await model.dispose();}
    }else{
      const model=await SamModel.from_pretrained(spec.repo,{revision:spec.revision,device:'wasm',dtype:'q8',local_files_only:true}),processor=await SamProcessor.from_pretrained(spec.repo,{revision:spec.revision,local_files_only:true}) as SamProcessor;
      try{for(const instance of payload.instances){
        const inputs=await processor(image,{input_points:[instance.points.map(p=>[p.x*image.width,p.y*image.height])],input_labels:[instance.points.map(p=>p.label)]}),output=await model(inputs),masks=await processor.post_process_masks(output.pred_masks,inputs.original_sizes,inputs.reshaped_input_sizes,{binarize:false});
        const scores=output.iou_scores.data;let best=0;for(let i=1;i<scores.length;i++)if(Number(scores[i])>Number(scores[best]))best=i;
        const n=image.width*image.height,mask=masks[0].data,pixels=new Uint8ClampedArray(n*4);let left=image.width,top=image.height,right=-1,bottom=-1;
        for(let i=0;i<n;i++){const value=Number(mask[best*n+i]);if(!Number.isFinite(value))throw new Error('Invalid local vision output.');const edge=Math.max(0,Math.min(1,value*.5+.5));pixels[i*4+3]=Math.round(255*edge*edge*(3-2*edge));for(let c=0;c<3;c++)pixels[i*4+c]=image.data[i*3+c];if(pixels[i*4+3]>3){left=Math.min(left,i%image.width);right=Math.max(right,i%image.width);top=Math.min(top,Math.floor(i/image.width));bottom=Math.max(bottom,Math.floor(i/image.width));}}
        if(right<left||bottom<top)throw new Error('No subject was found. Adjust the selection points.');
        const margin=Math.ceil(instance.feather*3);left=Math.max(0,left-margin);top=Math.max(0,top-margin);right=Math.min(image.width-1,right+margin);bottom=Math.min(image.height-1,bottom+margin);
        const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!,result=new OffscreenCanvas(right-left+1,bottom-top+1),out=result.getContext('2d')!;
        try{ctx.putImageData(new ImageData(pixels,image.width,image.height),0,0);if(instance.feather){const alpha=new OffscreenCanvas(image.width,image.height),a=alpha.getContext('2d')!;try{a.filter=`blur(${instance.feather}px)`;a.drawImage(canvas,0,0);const feathered=a.getImageData(0,0,image.width,image.height).data;for(let i=0;i<n;i++)pixels[i*4+3]=feathered[i*4+3];ctx.putImageData(new ImageData(pixels,image.width,image.height),0,0);}finally{alpha.width=1;}}out.drawImage(canvas,left,top,result.width,result.height,0,0,result.width,result.height);items.push({blob:await result.convertToBlob({type:'image/png'}),width:result.width,height:result.height,instance_id:instance.id});}finally{canvas.width=1;result.width=1;}
      }}finally{await model.dispose();}
    }
    self.postMessage({items});
  }catch{self.postMessage({error:'Local vision inference failed. Check the model files and available memory.'});}
};
