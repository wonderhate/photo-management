/** Presentation-only album preferences, scoped to a library rather than a page. */
export type AlbumListPreferences={sort:'custom'|'name'|'created_at'|'count';direction:'asc'|'desc';order:string[];view:'cards'|'table'};
export const albumListDefaults:AlbumListPreferences={sort:'custom',direction:'asc',order:[],view:'cards'};
export function validateAlbumListPreferences(value:unknown):Partial<AlbumListPreferences>{
  const fail=():never=>{throw new Error('影集列表设置无效');};
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  for(const [key,item] of Object.entries(value)){
    if(key==='sort'){if(!['custom','name','created_at','count'].includes(item))return fail();}
    else if(key==='direction'){if(!['asc','desc'].includes(item))return fail();}
    else if(key==='view'){if(!['cards','table'].includes(item))return fail();}
    else if(key==='order'){if(!Array.isArray(item)||item.length>10000||item.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))||new Set(item).size!==item.length)return fail();}
    else return fail();
  }
  return structuredClone(value) as Partial<AlbumListPreferences>;
}
type AlbumRow={id:string;name:string;count:number;created_at?:string};
export function albumList<T extends AlbumRow>(albums:readonly T[],preferences:AlbumListPreferences,search='',locale='zh-CN'):T[]{
  const collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'}),sign=preferences.direction==='desc'?-1:1;
  const rank=new Map(preferences.order.map((id,i)=>[id,i]));
  const fallback=new Map(albums.map((a,i)=>[a.id,i]));
  const date=(a:AlbumRow)=>a.created_at&&Number.isFinite(Date.parse(a.created_at))?Date.parse(a.created_at):null;
  const byId=(a:AlbumRow,b:AlbumRow)=>a.id<b.id?-1:a.id>b.id?1:0;
  const timeOrder=(a:AlbumRow,b:AlbumRow,direction:number)=>{const av=date(a),bv=date(b);return av==null?bv==null?0:1:bv==null?-1:(av-bv)*direction;};
  const needle=search.trim().toLocaleLowerCase(locale);
  return albums.filter(a=>!needle||a.name.toLocaleLowerCase(locale).includes(needle)).sort((a,b)=>{
    if(preferences.sort==='custom'){
      const av=rank.get(a.id),bv=rank.get(b.id);
      // New albums created elsewhere precede the explicitly arranged list.
      if(av!=null||bv!=null)return av==null?-1:bv==null?1:av-bv;
      return timeOrder(a,b,-1)||fallback.get(a.id)!-fallback.get(b.id)!;
    }
    return (preferences.sort==='name'?collator.compare(a.name,b.name)*sign:preferences.sort==='count'?(a.count-b.count)*sign:timeOrder(a,b,sign))||byId(a,b);
  });
}
/** Keep hidden albums and their relative order when moving a searched result. */
export function moveAlbum(ids:readonly string[],source:string,target:string,after=false):string[]{
  if(source===target||!ids.includes(source)||!ids.includes(target))return [...ids];
  const next=ids.filter(id=>id!==source),index=next.indexOf(target);next.splice(index+(after?1:0),0,source);return next;
}
