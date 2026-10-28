let activeMutations=0,maintaining=false;
export function assertLibraryWritable(){if(maintaining)throw new Error('Library maintenance is active. Try again after it finishes.');}
export function enterLibraryMutation(){assertLibraryWritable();activeMutations++;let left=false;return()=>{if(!left){left=true;activeMutations--;}};}
export function mutationMethod<A extends unknown[],R>(method:(...args:A)=>Promise<R>){return async(...args:A):Promise<R>=>{const leave=enterLibraryMutation();try{return await method(...args);}finally{leave();}};}
export async function maintainLibrary<T>(operation:()=>Promise<T>):Promise<T>{
  if(maintaining||activeMutations>0)throw new Error('Wait for other saves before maintaining the library.');
  maintaining=true;try{return await operation();}finally{maintaining=false;}
}
