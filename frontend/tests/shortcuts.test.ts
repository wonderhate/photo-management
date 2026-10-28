import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SHORTCUTS,DEFAULT_BINDINGS,ACTION_LABELS,shortcutAction,getBindings,saveBinding,eventKey,displayKey,ariaShortcut} from '../src/shortcuts.ts';

const event=(key:string,extra:Record<string,boolean>={})=>({key,ctrlKey:false,metaKey:false,...extra});
test('shortcut registry applies library, viewer, editor and modal/input scopes before dispatch',()=>{
  assert.deepEqual(Object.keys(SHORTCUTS),Object.keys(DEFAULT_BINDINGS));assert.deepEqual(Object.keys(SHORTCUTS),Object.keys(ACTION_LABELS));
  assert.equal(shortcutAction(event('Delete'),DEFAULT_BINDINGS,{scope:'library'}),'remove');
  assert.equal(shortcutAction(event('Delete'),DEFAULT_BINDINGS,{scope:'viewer'}),'remove');
  for(const scope of ['editor','other'] as const)assert.equal(shortcutAction(event('Delete'),DEFAULT_BINDINGS,{scope}),undefined);
  assert.equal(shortcutAction(event('f'),DEFAULT_BINDINGS,{scope:'viewer'}),'favorite');
  assert.equal(shortcutAction(event('f'),DEFAULT_BINDINGS,{scope:'library'}),undefined);
  for(const flag of ['typing','modal','recording','menu'])assert.equal(shortcutAction(event('Delete'),DEFAULT_BINDINGS,{scope:'library',[flag]:true}),undefined);
  for(const flag of ['defaultPrevented','isComposing','altKey'])assert.equal(shortcutAction(event('Delete',{[flag]:true}),DEFAULT_BINDINGS,{scope:'library'}),undefined);
  assert.equal(shortcutAction(event('a',{metaKey:true}),DEFAULT_BINDINGS,{scope:'library'}),'selectAll');
  assert.equal(shortcutAction(event('a',{ctrlKey:true}),DEFAULT_BINDINGS,{scope:'editor'}),undefined);
});

test('editor bindings distinguish modifiers, preserve text keys and expose matching menu hints',()=>{
  assert.equal(shortcutAction(event('s',{ctrlKey:true}),DEFAULT_BINDINGS,{scope:'editor'}),'editorSave');
  assert.equal(shortcutAction(event('s',{ctrlKey:true}),DEFAULT_BINDINGS,{scope:'viewer'}),undefined);
  assert.equal(shortcutAction(event('e',{ctrlKey:true}),DEFAULT_BINDINGS,{scope:'library'}),'exportSel');
  assert.equal(shortcutAction(event('e',{ctrlKey:true}),DEFAULT_BINDINGS,{scope:'editor'}),'editorExport');
  assert.equal(eventKey(event('O',{ctrlKey:true,shiftKey:true})),'ctrl+shift+o');
  assert.equal(shortcutAction(event('O',{ctrlKey:true,shiftKey:true}),DEFAULT_BINDINGS,{scope:'editor'}),'editorReference');
  assert.equal(shortcutAction(event('o',{ctrlKey:true}),DEFAULT_BINDINGS,{scope:'editor'}),'editorOpen');
  assert.equal(eventKey(event('Z',{shiftKey:true})),'shift+z');assert.equal(eventKey(event('Z')),'z');
  assert.equal(eventKey(event('?',{shiftKey:true})),'?');assert.equal(eventKey(event('+',{shiftKey:true})),'+');
  assert.equal(displayKey('ctrl+shift+o'),'Ctrl + Shift + O');assert.equal(ariaShortcut('ctrl+shift+o'),'Control+Shift+O');assert.equal(ariaShortcut('+'),'Plus');assert.equal(ariaShortcut('ctrl++'),'Control+Plus');
});

test('rebinding rejects overlapping conflicts, preserves compatible old preferences and reports failed storage',()=>{
  const values=new Map<string,string>(),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  try{
    assert.deepEqual(saveBinding('prev','f'),{ok:false,conflict:'favorite'});assert.equal(getBindings().prev,'ArrowLeft');
    assert.deepEqual(saveBinding('prev','q'),{ok:true});assert.equal(getBindings().prev,'q');
    assert.deepEqual(saveBinding('selectAll','f'),{ok:true});
    assert.equal(shortcutAction(event('f'),getBindings(),{scope:'library'}),'selectAll');assert.equal(shortcutAction(event('f'),getBindings(),{scope:'viewer'}),'favorite');
    values.set('shortcuts',JSON.stringify({prev:'z',next:14,remove:'Escape',unsupported:'x'}));
    assert.equal(getBindings().prev,'z');assert.equal(getBindings().next,'ArrowRight');assert.equal(getBindings().remove,'Delete');assert.equal(getBindings().unsupported,undefined);
    assert.equal(getBindings().viewerActual,'');assert.equal(shortcutAction(event('z'),getBindings(),{scope:'viewer'}),'prev');
    values.set('shortcuts',JSON.stringify({favorite:'b'}));assert.equal(getBindings().favorite,'b');assert.equal(getBindings().viewerProof,'');
    assert.equal(shortcutAction(event('b'),getBindings(),{scope:'viewer'}),'favorite');assert.deepEqual(saveBinding('viewerProof','g'),{ok:true});assert.equal(shortcutAction(event('g'),getBindings(),{scope:'viewer'}),'viewerProof');
    values.set('shortcuts',JSON.stringify({help:'ctrl+s'}));assert.equal(getBindings().editorSave,'');assert.equal(shortcutAction(event('s',{ctrlKey:true}),getBindings(),{scope:'editor'}),'help');assert.deepEqual(saveBinding('editorSave','ctrl+shift+o'),{ok:false,conflict:'editorReference'});assert.deepEqual(saveBinding('editorSave','ctrl+shift+s'),{ok:true});assert.equal(shortcutAction(event('S',{ctrlKey:true,shiftKey:true}),getBindings(),{scope:'editor'}),'editorSave');
    values.set('shortcuts','corrupt');assert.deepEqual(getBindings(),DEFAULT_BINDINGS);
    assert.deepEqual(saveBinding('remove','Escape'),{ok:false,error:'invalid'});
    storage.setItem=()=>{throw new Error('storage unavailable');};assert.deepEqual(saveBinding('prev','q'),{ok:false,error:'storage'});
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage');}
});
