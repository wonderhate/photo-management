import {validateDemoSample} from '../core/demo-sample';
import {createDemoImage} from './demo-image';
import {bt} from './text';

/** Only an explicitly published, same-origin, hash-pinned display copy. */
export async function publishedSample(){
  const response=await fetch('/demo/sample.json',{cache:'no-cache',redirect:'error'});
  if(response.status===404)return {file:await createDemoImage(),illustration:true};
  if(!response.ok)throw new Error(bt('示例照片读取失败，请重试。','The sample photo could not be loaded. Please retry.'));
  const text=await response.text();if(text.length>2048)throw new Error('Invalid published demo photo.');
  const sample=validateDemoSample(JSON.parse(text));
  const image=await fetch(sample.src,{redirect:'error'});if(!image.ok||!image.headers.get('content-type')?.startsWith('image/jpeg'))throw new Error('Invalid published demo photo.');
  const bytes=await image.arrayBuffer();if(bytes.byteLength>25*1024*1024)throw new Error('Invalid published demo photo.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(hash!==sample.sha256)throw new Error(bt('示例照片校验失败，请重新载入。','The sample photo failed verification. Please reload it.'));
  const file=new File([bytes],'lumina-sample.jpg',{type:'image/jpeg'}),bitmap=await createImageBitmap(file);
  const valid=bitmap.width===sample.width&&bitmap.height===sample.height;bitmap.close();if(!valid)throw new Error('Invalid published demo photo.');
  return {file,illustration:false};
}
