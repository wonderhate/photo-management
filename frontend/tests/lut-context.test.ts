import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLutContext,lutImportGroups,lutInputComments,lutRootLabel} from '../src/core/lut-context.ts';
import {validateLutAsset} from '../src/core/lut-contract.ts';
import {copiedLuts,inLutGroup} from '../src/core/lut-library.ts';
import {guessLogInput} from '../src/core/lut-log.ts';
const legacy={version:1,id:'a'.repeat(64),name:'Look.cube',title:'',size:2,bytes:100,favorite:false,hidden:false,used_at:null};
test('copied LUT provenance rejects paths, mismatched names, future metadata and excessive trees',()=>{
 assert.deepEqual(lutImportGroups({name:'Look.cube',webkitRelativePath:'Pack/Cinema/Portrait/Look.cube'}),['Pack','Cinema','Portrait']);
 for(const groups of [['..'],['\ud800'],['/abs'],['C:'],['a\\b'],['a/b'],[''],Array(10).fill('x')])assert.throws(()=>validateLutContext({groups,comments:[]}));
 assert.throws(()=>lutImportGroups({name:'Look.cube',webkitRelativePath:'Pack/Other.cube'}));
 validateLutAsset(legacy);validateLutAsset({...legacy,version:2,context:{groups:[],comments:[]}});assert.throws(()=>validateLutAsset({...legacy,version:2}));assert.throws(()=>validateLutAsset({...legacy,version:3}));
});
test('source comments remain display hints after the linked directory disappears',()=>{
 const context={groups:['Pack','Cinema'],comments:lutInputComments('# not for log footage\n# Input: V-Log\nLUT_3D_SIZE 2')};validateLutContext(context);assert.deepEqual(context.comments,['Input: V-Log']);assert.equal(lutInputComments('# Input: '+'😀'.repeat(400))[0].length,511);assert.equal(guessLogInput({name:'Look',folders:context.groups,comments:context.comments}),'V-Log');
 const asset={...legacy,version:2 as const,context};assert.deepEqual(copiedLuts([asset],[]),[asset]);assert.equal(inLutGroup(asset,'Pack'),true);assert.equal(inLutGroup(asset,'Pack/Cinema'),true);assert.equal(inLutGroup(asset,'Pac'),false);
});

test('volume-root and share labels remain display groups without becoming paths',()=>{assert.equal(lutRootLabel('E:\\'),'E');assert.equal(lutRootLabel('\\\\server\\share\\'),'server · share');assert.equal(lutRootLabel('Camera Pack'),'Camera Pack');validateLutContext({groups:[lutRootLabel('E:\\')],comments:[]});});
