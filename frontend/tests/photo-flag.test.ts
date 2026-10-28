import {test} from 'node:test';
import assert from 'node:assert/strict';
import {photoFlag,flagSuccessor} from '../src/core/photo-flag.ts';
import {shortcutAction,DEFAULT_BINDINGS} from '../src/shortcuts.ts';
test('neutral flags and the next existing position remain separate from stars and favorites',()=>{
  assert.equal(photoFlag(undefined),'unmarked');assert.equal(photoFlag(null),'unmarked');
  for(const flag of ['picked','rejected','unmarked'])assert.equal(photoFlag(flag),flag);
  for(const bad of ['keep','none',false,1,[],{}])assert.throws(()=>photoFlag(bad));
  assert.equal(flagSuccessor(['a','b','c'],'b'),'c');assert.equal(flagSuccessor(['a','b','c'],'c'),undefined);assert.equal(flagSuccessor(['a','b'],'missing'),undefined);
});
test('P X U and explicit Shift variants share command scope and typing protection',()=>{
  for(const [key,id] of [['p','flagPick'],['x','flagReject'],['u','flagClear']])for(const scope of ['library','viewer'] as const){
    const event={key,ctrlKey:false,metaKey:false};assert.equal(shortcutAction(event,DEFAULT_BINDINGS,{scope}),id);
    assert.equal(shortcutAction({...event,key:key.toUpperCase(),shiftKey:true},DEFAULT_BINDINGS,{scope}),id+'Next');
    assert.equal(shortcutAction(event,DEFAULT_BINDINGS,{scope,typing:true}),undefined);assert.equal(shortcutAction(event,DEFAULT_BINDINGS,{scope,modal:true}),undefined);
    assert.equal(shortcutAction(event,DEFAULT_BINDINGS,{scope:'editor'}),undefined);
  }
});
