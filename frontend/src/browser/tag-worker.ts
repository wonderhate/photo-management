import {TagIndex} from '../core/tag-index';
let index:TagIndex|null=null;
self.onmessage=({data})=>{
  try{if(data.action==='build')index=new TagIndex(data.rows);else if(data.action!=='query')throw new Error('Invalid photo tags query.');if(!index)throw new Error('Tag index is not ready.');self.postMessage({id:data.id,result:data.action==='build'?true:index.query(data.options)});}
  catch(e){self.postMessage({id:data.id,error:e instanceof Error?e.message:'Tag index is not ready.'});}
};
