import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollage} from '../src/core/collage.ts';
import {validateCollageOutput,validateCollageOutputSave,collageOutputPath} from '../src/core/collage-output.ts';
test('collage output snapshot validates frozen dimensions and owned asset identities',()=>{
 const source={id:'source',name:'source.png',sha256:'a'.repeat(64),width:600,height:400,bits:8 as const,profile:{version:2 as const,extra_orientation:1}},scene=createCollage([source]),id=crypto.randomUUID(),project={version:1 as const,id:crypto.randomUUID(),request_id:crypto.randomUUID(),name:'Saved project',revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),origin_library_id:'library',photo_links:[],document:{kind:'single' as const,value:scene}},record={version:1 as const,id,project,page:0,format:'webp' as const,quality:90,sha256:'b'.repeat(64),width:scene.width,height:scene.height,created_at:new Date().toISOString()},stored={...record,storage_id:crypto.randomUUID(),assets:[{sha256:source.sha256,storage_id:crypto.randomUUID()}]};
 validateCollageOutput(record);validateCollageOutput(stored,true);assert.match(collageOutputPath(stored),/^drafts\/collage-outputs\/[a-f0-9-]+\/b{64}\.webp$/);
 for(const patch of [{page:1},{width:123},{quality:0},{version:2},{private_path:'secret'},{sha256:'x'}])assert.throws(()=>validateCollageOutput({...record,...patch} as never));
 for(const patch of [{storage_id:'../escape'},{assets:[]},{assets:[{...stored.assets[0],storage_id:'bad'}]}])assert.throws(()=>validateCollageOutput({...stored,...patch},true));
 const before=structuredClone(record);project.document.value.width=800;assert.equal(before.project.document.value.width,2400);
});
test('collage output requests reject invalid versions pages formats and extra fields',()=>{
 const payload={id:crypto.randomUUID(),project_id:crypto.randomUUID(),project_revision:1,page:0,format:'png' as const,quality:95,sha256:'a'.repeat(64)};validateCollageOutputSave(payload);
 for(const patch of [{page:240},{page:NaN},{project_revision:0},{quality:true},{format:'gif'},{source:'secret'},{id:'../'}])assert.throws(()=>validateCollageOutputSave({...payload,...patch} as never));
});
