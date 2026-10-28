/** Rebuildable inverted metadata index; never reads photo files or AI raw annotations. */
export type TagRow={id:string;tags:string[];tag_origins?:Record<string,string>};
export type TagOptions={term?:string;page?:number;size?:number;order?:'name'|'count'|'manual';ids?:string[];origins?:boolean};
export type TagPage={field:'tag';total:number;missing:number;page:number;has_more:boolean;values:{value:string;count:number;user_count?:number}[]};
export function lexical(a:string,b:string){const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d;}return x.length-y.length;}
export function validateTagOptions({term='',page=1,size=60,order='name'}:TagOptions){
  if(typeof term!=='string'||[...term].length>256||term.includes('\0')||!Number.isInteger(page)||page<1||page>1000000||!Number.isInteger(size)||size<1||size>100||!['name','count','manual'].includes(order))throw new Error('Invalid photo tags query.');
  return {term:term.toLowerCase(),page,size,order};
}
export class TagIndex{
  private ids=new Map<string,number>();
  private present=new Set<number>();
  private rows:{name:string;folded:string;photos:number[];manual:number[]}[]=[];
  constructor(rows:TagRow[]){
    const tags=new Map<string,{name:string;folded:string;photos:number[];manual:number[]}>();
    for(const [i,p] of rows.entries()){
      this.ids.set(p.id,i);for(const tag of new Set(p.tags)){
        this.present.add(i);let row=tags.get(tag);if(!row){row={name:tag,folded:tag.toLowerCase(),photos:[],manual:[]};tags.set(tag,row);}row.photos.push(i);if(p.tag_origins?.[tag]!=='ai')row.manual.push(i);
      }
    }
    this.rows=[...tags.values()].sort((a,b)=>lexical(a.name,b.name));
  }
  query(options:TagOptions={}):TagPage{
    const {term,page,size,order}=validateTagOptions(options),eligible=options.ids?new Set(options.ids.map(id=>this.ids.get(id)).filter((v):v is number=>v!==undefined)):null;
    const total=eligible?.size??this.ids.size,missing=total-(eligible?[...eligible].filter(i=>this.present.has(i)).length:this.present.size),values:{value:string;count:number;user_count?:number}[]=[];
    const count=(rows:number[])=>eligible?rows.reduce((n,i)=>n+Number(eligible.has(i)),0):rows.length;
    for(const row of this.rows){if(!row.folded.includes(term))continue;const n=count(row.photos);if(n)values.push({value:row.name,count:n,...(options.origins||order==='manual'?{user_count:count(row.manual)}:{})});}
    if(order==='count')values.sort((a,b)=>b.count-a.count||lexical(a.value,b.value));
    else if(order==='manual')values.sort((a,b)=>Number(!!b.user_count)-Number(!!a.user_count)||lexical(a.value,b.value));
    const start=(page-1)*size;
    return {field:'tag',total,missing,page,has_more:values.length>start+size,values:values.slice(start,start+size).map(v=>options.origins?v:{value:v.value,count:v.count})};
  }
}
