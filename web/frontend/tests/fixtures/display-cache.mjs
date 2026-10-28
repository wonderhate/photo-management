export async function cacheRows(page){return page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('photocollection-display-cache',1);
  request.onupgradeneeded=()=>request.transaction.abort();
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Display cache fixture is blocked.'));
  request.onsuccess=()=>{
    const db=request.result;
    try{
      const tx=db.transaction('entries'),read=tx.objectStore('entries').getAll();let rows;
      read.onsuccess=()=>{rows=read.result;};
      tx.oncomplete=()=>{db.close();resolve(rows);};tx.onabort=()=>{db.close();reject(tx.error||new Error('Display cache fixture read failed.'));};
    }catch(error){db.close();reject(error);}
  };
}));}
export async function damageCache(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('photocollection-display-cache',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['entries','images'],'readwrite');tx.objectStore('entries').getAll().onsuccess=event=>{tx.objectStore('images').put(new Blob(['damaged JPEG']),event.target.result[0].key);};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}));}
// Valid cached JPEGs in other libraries model a profile shared across many catalogs.
export async function seedOtherLibraries(page,count=64){return page.evaluate(count=>new Promise((resolve,reject)=>{const request=indexedDB.open('photocollection-display-cache',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['entries','images'],'readwrite'),entries=tx.objectStore('entries'),images=tx.objectStore('images');entries.getAll().onsuccess=event=>{const original=event.target.result[0];images.get(original.key).onsuccess=event=>{for(let i=0;i<count;i++){const key=JSON.parse(original.key),library='cache-fixture-'+i;key[1]=library;const name=JSON.stringify(key);entries.put({...original,key:name,library,stamp:0});images.put(event.target.result,name);}};};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};}),count);}
