import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const records=JSON.parse(await readFile(new URL('./raw-fixtures.json',import.meta.url),'utf8'));
const root=new URL('../../.test-artifacts/raw-fixtures/',import.meta.url);await mkdir(root,{recursive:true});
await Promise.all(records.map(async item=>{const path=new URL(item.name,root),hash=bytes=>createHash('sha256').update(bytes).digest('hex');try{if(hash(await readFile(path))===item.sha256){console.log(item.name+': verified cached fixture');return;}}catch{}const response=await fetch(item.url,{signal:AbortSignal.timeout(240000)});if(!response.ok)throw new Error(item.name+': HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw new Error(item.name+': fixture checksum mismatch');await writeFile(path,bytes);console.log(item.name+': downloaded and verified');}));
