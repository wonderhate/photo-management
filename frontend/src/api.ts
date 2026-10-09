export async function api<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const response = await fetch('/api'+path, {method, headers:body===undefined?undefined:{'Content-Type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body)});
  if (!response.ok) {
    const error = await response.json().catch(()=>({detail:'请求失败'})) as {detail:unknown};
    throw new Error(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail));
  }
  return response.json() as Promise<T>;
}
export function message(error:unknown):string {return error instanceof Error?error.message:String(error)}
export function query(values:Record<string,string|number|undefined>):string {return new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString()}
