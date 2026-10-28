/** A read projection of existing IDs. Membership and manual RAW links are not derivations. */
export const ASSET_KINDS=['photo','capture','raw','edit','variant','watercolor','watermark','collage','collage-output','split','ai-result'] as const;
export type AssetKind=typeof ASSET_KINDS[number];
export type AssetNode={key:string;kind:AssetKind;id:string;name:string;revision?:number;removed?:boolean;missing?:boolean};
export type AssetLink={from:string;to:string;kind:'capture-member'|'raw-source'|'edit-source'|'rendered-from'|'watermark-source'|'watercolor-source'|'collage-source'|'split-source'|'ai-source'|'ai-version';revision?:number};
export type DerivedGraph={focus:string;nodes:AssetNode[];links:AssetLink[];truncated:boolean};
export class AssetGraph {
  private nodes=new Map<string,AssetNode>();private links=new Map<string,AssetLink>();
  node(kind:AssetKind,id:string,name:string,details:Partial<Pick<AssetNode,'revision'|'removed'|'missing'>>={}){const key=`${kind}:${id}`;this.nodes.set(key,{key,kind,id,name,...details});return key;}
  link(from:string,to:string,kind:AssetLink['kind'],revision?:number){if(from===to)return;for(const key of [from,to])if(!this.nodes.has(key)){const i=key.indexOf(':');this.node(key.slice(0,i) as AssetKind,key.slice(i+1),key.slice(i+1),{missing:true});}const value={from,to,kind,...(revision===undefined?{}:{revision})};this.links.set(JSON.stringify(value),value);}
  view(kind:AssetKind,id:string):DerivedGraph{
    if(!ASSET_KINDS.includes(kind)||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new Error('Invalid asset graph selection.');
    const focus=`${kind}:${id}`;if(!this.nodes.has(focus))throw new Error('Asset record no longer exists.');
    const adjacent=new Map<string,AssetLink[]>();for(const edge of this.links.values())for(const key of [edge.from,edge.to]){const list=adjacent.get(key)||[];list.push(edge);adjacent.set(key,list);}
    const selected=new Set([focus]),queue=[{key:focus,depth:0}];let truncated=false;
    for(let i=0;i<queue.length;i++)for(const edge of adjacent.get(queue[i].key)||[]){const key=edge.from===queue[i].key?edge.to:edge.from;if(selected.has(key))continue;if(selected.size>=80||queue[i].depth>=6){truncated=true;continue;}selected.add(key);queue.push({key,depth:queue[i].depth+1});}
    const links=[...this.links.values()].filter(e=>selected.has(e.from)&&selected.has(e.to));if(links.length>160)truncated=true;
    return {focus,nodes:[...selected].map(key=>this.nodes.get(key)!),links:links.slice(0,160),truncated};
  }
}
