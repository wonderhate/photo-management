// A single basename, independent of OS separators; never a caller-supplied path.
export function splitExportStem(masterName:string){
  const name=masterName.replace(/\.png$/i,'').replace(/(?:_split-master|-master)$/,'');
  const safe=Array.from(name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'')).slice(0,100).join('')||'photo';
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe)?'photo_'+safe:safe;
}
export function splitExportNames(stem:string,format:'png'|'jpg',count:number,subfolder:boolean,attempt=0){
  if(!stem||/[<>:"/\\|?*\x00-\x1f]/.test(stem)||!['png','jpg'].includes(format)||!Number.isInteger(count)||count<2||count>10||!Number.isInteger(attempt)||attempt<0||attempt>=10000)throw new Error('Invalid seamless split.');
  const prefix=stem+'_split'+(attempt?'_'+attempt:'');
  return {folder:subfolder?prefix:'',files:Array.from({length:count},(_,i)=>(subfolder?stem+'_split':prefix)+'_'+String(i+1).padStart(2,'0')+'.'+format)};
}
