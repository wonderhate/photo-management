export type DemoSample={version:1;src:string;width:number;height:number;sha256:string};
export function validateDemoSample(value:unknown):DemoSample{
  const v=value as DemoSample;
  if(!v||v.version!==1||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||v.src!==`/demo/images/${v.sha256}.jpg`||!Number.isInteger(v.width)||!Number.isInteger(v.height)||v.width<1||v.height<1||v.width>8192||v.height>8192||Object.keys(v).some(key=>!['version','src','width','height','sha256'].includes(key)))throw new Error('Invalid published demo photo.');
  return {version:1,src:v.src,width:v.width,height:v.height,sha256:v.sha256};
}
