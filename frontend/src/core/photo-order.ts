export const PHOTO_SORTS=['date_taken','created_at','file_name','rating'] as const;
export type PhotoSort=typeof PHOTO_SORTS[number];
export function photoSort(value:unknown):PhotoSort{return PHOTO_SORTS.includes(value as PhotoSort)?value as PhotoSort:'date_taken';}
type Row={id:string;date_taken?:string|null;created_at?:string;file_name?:string;rating?:number|null};
// Compare Unicode code points, independent of the host's language and UTF-16 order.
function binary(a:string,b:string){
  let i=0,j=0;
  while(i<a.length&&j<b.length){const x=a.codePointAt(i)!,y=b.codePointAt(j)!;if(x!==y)return x-y;i+=x>65535?2:1;j+=y>65535?2:1;}
  return i<a.length?1:j<b.length?-1:0;
}
export function photoOrder(sort:unknown,direction:unknown){
  const field=photoSort(sort),sign=direction==='asc'?1:-1;
  return (a:Row,b:Row)=>{
    const av=a[field],bv=b[field];
    if(av==null)return bv==null?binary(a.id,b.id):1;
    if(bv==null)return -1;
    const primary=typeof av==='number'&&typeof bv==='number'?av-bv:binary(String(av),String(bv));
    return primary?sign*primary:binary(a.id,b.id);
  };
}
