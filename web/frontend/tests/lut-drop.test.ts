import test from 'node:test';
import assert from 'node:assert/strict';
import {collectLutDrop} from '../src/core/lut-drop.ts';
import type {LutDropEntry} from '../src/core/lut-drop.ts';
import {lutImportGroups} from '../src/core/lut-context.ts';
const file=(name:string):LutDropEntry=>({name,isFile:true,isDirectory:false,file:ok=>ok(new File(['exact bytes'],name))});
function dir(name:string,children:LutDropEntry[]):LutDropEntry{return {name,isFile:false,isDirectory:true,createReader:()=>{let at=0;return {readEntries:ok=>ok(children.slice(at,at+=2))};}};}
test('LUT drop drains all directory-reader batches and preserves exact bytes and groups',async()=>{
 const files=await collectLutDrop({entries:[dir('Pack',[file('One.cube'),dir('Cinema',[file('Two.CUBE')]),file('License.txt')])],files:[]});
 assert.deepEqual(files.map(f=>f.webkitRelativePath),['Pack/One.cube','Pack/Cinema/Two.CUBE','Pack/License.txt']);assert.deepEqual(lutImportGroups(files[1]),['Pack','Cinema']);assert.equal(await files[1].text(),'exact bytes');
 const single=new File(['fallback'],'Fallback.cube');assert.deepEqual(await collectLutDrop({entries:[],files:[single]}),[single]);
});
test('LUT drop refuses too many files or excessive depth before any import',async()=>{
 await assert.rejects(collectLutDrop({entries:[],files:Array.from({length:5001},()=>new File(['x'],'x.cube'))}),/Too many/);
 let deep=file('Tone.cube');for(let i=0;i<10;i++)deep=dir('Level'+i,[deep]);await assert.rejects(collectLutDrop({entries:[deep],files:[]}),/too deep/);
});
test('LUT drop stops when its owner closes during an asynchronous file read',async()=>{
 let active=true,done!:(file:File)=>void;const pending=collectLutDrop({entries:[{name:'Late.cube',isFile:true,isDirectory:false,file:ok=>{done=ok;}}],files:[]},()=>active);
 active=false;done(new File(['late'],'Late.cube'));await assert.rejects(pending,{name:'AbortError'});
});
