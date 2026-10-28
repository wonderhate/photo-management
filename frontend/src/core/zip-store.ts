/** Minimal ZIP32 STORE writer for already-compressed image outputs; no original files. */
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32Update(crc:number,bytes:Uint8Array){for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return crc>>>0;}
export async function zipStore(entries:{name:string;blob:Blob}[],maxBytes=256*1024*1024):Promise<Blob>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<22||maxBytes>0xffffffff)throw new Error('Invalid collage archive size.');
 if(entries.length>65535)throw new Error('Too many collage archive entries.');const parts:BlobPart[]=[],central:Uint8Array<ArrayBuffer>[]=[],seen=new Set<string>();let offset=0;
 for(const entry of entries){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(entry.name)||seen.has(entry.name.toLowerCase()))throw new Error('Invalid collage archive name.');seen.add(entry.name.toLowerCase());
  const name=new TextEncoder().encode(entry.name);if(offset+entry.blob.size+30+name.length>maxBytes)throw new Error('Collage archive exceeds the size limit.');
  let crc=0xffffffff,yielded=0;const reader=entry.blob.stream().getReader();try{while(true){const part=await reader.read();if(part.done)break;crc=crc32Update(crc,part.value);yielded+=part.value.length;if(yielded>=8*1024*1024){yielded=0;await new Promise(resolve=>setTimeout(resolve,0));}}}finally{reader.releaseLock();}crc=(crc^0xffffffff)>>>0;
  const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,entry.blob.size,true);l.setUint32(22,entry.blob.size,true);l.setUint16(26,name.length,true);local.set(name,30);
  const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,entry.blob.size,true);d.setUint32(24,entry.blob.size,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);parts.push(local,entry.blob);offset+=local.length+entry.blob.size;
 }
 const size=central.reduce((sum,c)=>sum+c.length,0);if(offset+size+22>maxBytes)throw new Error('Collage archive exceeds the size limit.');
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});
}
