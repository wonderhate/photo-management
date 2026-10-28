import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guessLogInput} from '../src/core/lut-log.ts';
import {lutStep,lutTreeAll,lutTreeOpen,lutViewDefaults} from '../src/core/lut-view.ts';
import {validateToolPreferences} from '../src/core/preferences.ts';
test('LUT Log hints distinguish input curves from output names and video-blog prose',()=>{
  for(const [name,expected] of [['S-Log3_to_Rec709.cube','S-Log'],['rec709_to_log.cube',null],['catalog.cube',null],['Vlog-海边人像.cube',null],['Panasonic_VLog_to_V709.cube','V-Log'],['Alexa.cube','LogC'],['LogC4.cube','LogC'],['RedLogFilm.cube','RED Log']])assert.equal(guessLogInput({name:name!}),expected);
  assert.equal(guessLogInput({name:'Portrait',title:'F-Log2'}),'F-Log');
  assert.equal(guessLogInput({name:'Portrait',comments:['not for log footage']}),null);
  assert.equal(guessLogInput({name:'Portrait',comments:['Input: V-Log']}),'V-Log');
  assert.equal(guessLogInput({name:'Portrait',folders:['Log','a','b']}),null);
});
test('LUT preferences accept independent marks and reject recipe, paths and malformed values',()=>{
  const key='mark:'+'a'.repeat(64),valid={columns:3,filter:'recent',hideLog:true,strength:.37,[key]:'normal'};
  assert.deepEqual(validateToolPreferences('lut',valid),valid);
  for(const v of [{columns:true},{columns:4},{strength:NaN},{strength:-1},{strength:2},{hideLog:1},{filter:'log'},{path:'private'}, {recipe:{}},{'mark:abc':'log'},{[key]:true},{[key]:'camera'}])assert.throws(()=>validateToolPreferences('lut',v));
});
test('LUT grid arrows preserve columns, clamp edges and reach the shorter last row',()=>{
  assert.equal(lutStep(-1,8,3,'ArrowRight'),0);
  assert.equal(lutStep(2,8,3,'ArrowDown'),5);
  assert.equal(lutStep(5,8,3,'ArrowDown'),7);
  assert.equal(lutStep(7,8,3,'ArrowDown'),7);
  assert.equal(lutStep(7,8,3,'ArrowUp'),4);
  assert.equal(lutStep(0,8,3,'ArrowLeft'),0);
  assert.equal(lutStep(39,42,3,'ArrowRight'),40);
  assert.equal(lutStep(0,0,3,'ArrowRight'),-1);
});
test('LUT all-folder state resets existing overrides and applies to newly discovered groups',()=>{
 const key='fold:library:Pack' as const,view={...lutViewDefaults,[key]:false};
 const opened={...view,...lutTreeAll(view,true)};validateToolPreferences('lut',opened);assert.equal(lutTreeOpen(opened,key),true);assert.equal(lutTreeOpen(opened,'fold:library:New'),true);
 const individual={...opened,[key]:false};assert.equal(lutTreeOpen(individual,key),false);
 const collapsed={...individual,...lutTreeAll(individual,false)};assert.equal(lutTreeOpen(collapsed,'fold:library:New'),false);assert.throws(()=>validateToolPreferences('lut',{treeExpanded:1}));
});
