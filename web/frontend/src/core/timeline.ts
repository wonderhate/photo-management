/** Calendar dates use the camera's wall date, never the viewer's time zone. */
export function cameraDay(value:string|null|undefined):string|null{
  if(!value)return null;const day=value.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day.startsWith('0000'))return null;
  const date=new Date(day+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day?day:null;
}
export function timelinePrefix(parts:string[]):string{
  if(parts.length<1||parts.length>3||!/^\d{4}$/.test(parts[0])||parts.slice(1).some(p=>!/^\d{1,2}$/.test(p)))throw new Error('Invalid timeline date.');
  const prefix=parts.map((p,i)=>i?p.padStart(2,'0'):p).join('-');
  if(!cameraDay(prefix+(parts.length===1?'-01-01':parts.length===2?'-01':'')))throw new Error('Invalid timeline date.');
  return prefix;
}
