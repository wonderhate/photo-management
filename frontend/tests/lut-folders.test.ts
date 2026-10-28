import test from 'node:test';
import assert from 'node:assert/strict';
import {lutHeader,validateLutFolders,folderAssets,validLutPath} from '../src/core/lut-folders.ts';
import {validLutViewField} from '../src/core/lut-view.ts';
const id='12345678-1234-1234-1234-123456789012';
const asset={version:1,id:'a'.repeat(64),name:'Look.cube',title:'Look',size:2,bytes:100,favorite:false,hidden:false,used_at:null};
const folder={version:1,id,binding:id,name:'Styles',revision:0,state:'ready',truncated:false,entries:[{path:'Cinema/Look.cube',stamp:'1:100',asset,comments:['Input: S-Log3'],error:null}]};
test('external LUT records reject unsafe paths, duplicate records and inconsistent assets',()=>{
 validateLutFolders([folder]);
 for(const path of ['../x.cube','/x.cube','C:\\x.cube','a//x.cube','a/./x.cube'])assert.equal(validLutPath(path),false);
 for(const change of [(f:any)=>f.entries.push(f.entries[0]),(f:any)=>f.entries[0].asset.name='Other.cube',(f:any)=>f.revision=-1,(f:any)=>f.binding=null,(f:any)=>f.entries[0].error='header']){const f=structuredClone(folder);change(f);assert.throws(()=>validateLutFolders([f]));}
 assert.throws(()=>validateLutFolders([folder,folder]));
});
test('LUT header retains input hints, rejects shapers and invalid headers',()=>{
 assert.deepEqual(lutHeader('# Input: S-Log3\nTITLE "Cinema"\nLUT_3D_SIZE 2\n0 0 0'),{size:2,title:'Cinema',comments:['Input: S-Log3']});
 for(const text of ['LUT_1D_SIZE 2','LUT_3D_SIZE 1','LUT_3D_SIZE 2\nLUT_3D_SIZE 2','TITLE "bad\nLUT_3D_SIZE 2'])assert.throws(()=>lutHeader(text));
});
test('stored copies retain user metadata and remain available when external folders go offline',()=>{
 const stored={...asset,favorite:true};assert.deepEqual(folderAssets([stored],[folder as any]),[stored]);assert.deepEqual(folderAssets([],[{...folder,state:'missing'} as any]),[]);
 assert.equal(validLutViewField('fold:'+id+':Cinema%2FLog',true),true);assert.equal(validLutViewField('fold:'+id+':Cinema','yes'),false);
});
