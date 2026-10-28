const resets=new Set<()=>void>();
export function registerResourceReset(reset:()=>void){resets.add(reset);return()=>{resets.delete(reset);};}
export function resetMediaResources(){for(const reset of resets)reset();}
