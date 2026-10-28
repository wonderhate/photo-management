const writers=new Set<()=>Promise<void>>();
const pending=new Set<Promise<unknown>>();
export function trackPreferenceWrite<T>(work:Promise<T>):Promise<T>{pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;}
export function registerPreferenceFlush(flush:()=>Promise<void>){writers.add(flush);return()=>{writers.delete(flush);};}
// Capture existing writes before a new hook registers its own cleanup promise.
export function waitForPendingPreferenceWrites(){return Promise.all([...pending]).then(()=>{});}
export async function flushPreferenceWrites(){await Promise.all([...writers].map(flush=>flush()));while(pending.size)await Promise.all([...pending]);}
