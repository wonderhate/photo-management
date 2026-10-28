export const ANNOTATION_QUERY_FIELDS=['text','description','user_description','ai_caption','detected_text'] as const;
type TextField=typeof ANNOTATION_QUERY_FIELDS[number];
const string=(v:unknown)=>typeof v==='string'?v:'';
const clean=(v:unknown)=>string(v).trim()||null;
function order(a:string,b:string){const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d;}return x.length-y.length;}
export function photoTextValue(photo:object,field:TextField):string|null{
  const p=photo as Record<string,unknown>,a=p.annotation&&typeof p.annotation==='object'?p.annotation as Record<string,unknown>:{};
  if(field==='user_description')return p.user_description==null?null:string(p.user_description);
  if(field==='description')return clean(p.user_description!=null?p.user_description:a.caption);
  if(field==='ai_caption')return clean(a.caption);
  if(field==='detected_text')return clean(a.detected_text);
  const tags=Array.isArray(p.tags)?p.tags.filter(t=>typeof t==='string').slice().sort(order).join(' '):'';
  return [p.file_name,p.camera_model,p.lens_model,tags,p.camera_make,photoTextValue(photo,'description'),photoTextValue(photo,'detected_text')].map(string).join(' ');
}
export function textContains(actual:unknown,wanted:string){return typeof actual==='string'&&actual.toLowerCase().includes(wanted.toLowerCase());}
