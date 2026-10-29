import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMemoryDirectory,isMemoryDirectory} from '../src/browser/memory-directory.ts';
const digest=async(value:Blob)=>createHash('sha256').update(new Uint8Array(await value.arrayBuffer())).digest('hex');

test('temporary filesystem keeps source bytes read-only and publishes each output atomically',async()=>{
  const sandbox=createMemoryDirectory(),root=sandbox.directory,source=new File(['synthetic original bytes'],'source.jpg',{type:'image/jpeg'}),before=await digest(source);
  try{
    assert.equal(isMemoryDirectory(root),true);
    const photos=await root.getDirectoryHandle('photos',{create:true}),original=await photos.getFileHandle(source.name,{create:true});
    const initial=await original.createWritable();await initial.write(source);await initial.close();
    const snapshot=await original.getFile();assert.equal(snapshot.type,'image/jpeg');assert.equal(await digest(snapshot),before);
    const output=await photos.getFileHandle('derived.png',{create:true}),writer=await output.createWritable();await writer.write(new Blob(['edited image'],{type:'image/png'}));
    assert.equal((await output.getFile()).size,0);
    await writer.close();assert.equal(await(await output.getFile()).text(),'edited image');assert.equal((await output.getFile()).type,'image/png');
    assert.equal(await digest(source),before);assert.equal(await digest(await original.getFile()),before);
    assert.deepEqual(await root.resolve(output),['photos','derived.png']);assert.deepEqual(await root.resolve(root),[]);
    assert.equal(await root.resolve(createMemoryDirectory('other').directory),null);
    assert.deepEqual((await Array.fromAsync(root.values())).map(x=>x.name),['photos']);
    assert.equal(await output.isSameEntry(original),false);
  }finally{sandbox.dispose();}
});

test('temporary writer abort, exclusivity and invalid paths cannot mutate completed files',async()=>{
  const sandbox=createMemoryDirectory(),root=sandbox.directory;
  try{
    const handle=await root.getFileHandle('safe.json',{create:true}),writer=await handle.createWritable();await writer.write('completed');await writer.close();
    const aborted=await handle.createWritable();await assert.rejects(handle.createWritable(),{name:'NoModificationAllowedError'});await aborted.write('discarded');await aborted.abort();assert.equal(await(await handle.getFile()).text(),'completed');
    for(const name of ['..','.','nested/file','back\\slash',''])await assert.rejects(root.getFileHandle(name,{create:true}),TypeError);
    await assert.rejects(root.getFileHandle('missing.json'),{name:'NotFoundError'});
    await assert.rejects(root.getDirectoryHandle('safe.json'),{name:'TypeMismatchError'});
    const folder=await root.getDirectoryHandle('nested',{create:true});await folder.getFileHandle('file',{create:true});
    await assert.rejects(root.removeEntry('nested'),{name:'InvalidModificationError'});await root.removeEntry('nested',{recursive:true});await assert.rejects(folder.getFileHandle('later',{create:true}),{name:'NotFoundError'});
  }finally{sandbox.dispose();}
});

test('temporary session disposal invalidates outstanding handles and uncommitted writers',async()=>{
  const sandbox=createMemoryDirectory(),root=sandbox.directory,handle=await root.getFileHandle('pending',{create:true}),writer=await handle.createWritable();await writer.write('not published');
  sandbox.dispose();sandbox.dispose();assert.equal(isMemoryDirectory(root),false);
  await assert.rejects(writer.close(),{name:'AbortError'});await assert.rejects(handle.getFile(),{name:'AbortError'});await assert.rejects(root.getFileHandle('new',{create:true}),{name:'AbortError'});
});

test('temporary filesystem enforces a total memory quota without replacing existing output',async()=>{
  const sandbox=createMemoryDirectory('bounded',12),root=sandbox.directory;
  try{
    const first=await root.getFileHandle('first',{create:true}),a=await first.createWritable();await a.write('12345678');await a.close();
    const second=await root.getFileHandle('second',{create:true}),b=await second.createWritable();await b.write('12345');await assert.rejects(b.close(),{name:'QuotaExceededError'});
    assert.equal(await(await first.getFile()).text(),'12345678');assert.equal((await second.getFile()).size,0);
    await root.removeEntry('first');const retry=await second.createWritable();await retry.write('retry');await retry.close();assert.equal(await(await second.getFile()).text(),'retry');
  }finally{sandbox.dispose();}
});
