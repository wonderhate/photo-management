import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GLASS_CONTROL_SELECTOR,GLASS_SURFACE_SELECTOR,installGlassInteractions} from '../src/glass-interaction.ts';

// An event/RAF harness keeps scheduling and cancellation deterministic. Real
// selectors, native focus and layout are covered by browser acceptance.
class Events{
  listeners=new Map<string,Set<(event:any)=>void>>();
  addEventListener(type:string,listener:(event:any)=>void){const set=this.listeners.get(type)||new Set();set.add(listener);this.listeners.set(type,set);}
  removeEventListener(type:string,listener:(event:any)=>void){this.listeners.get(type)?.delete(listener);}
  emit(type:string,event:Record<string,unknown>={}){for(const listener of [...this.listeners.get(type)||[]])listener(event);}
  count(){return [...this.listeners.values()].reduce((count,listeners)=>count+listeners.size,0);}
}
class Node extends Events{
  dataset:Record<string,string>={};
  values=new Map<string,string>();
  style={setProperty:(key:string,value:string)=>this.values.set(key,value),removeProperty:(key:string)=>this.values.delete(key)};
  isConnected=true;focused=false;disabled=false;excluded=false;image=false;
  readonly kind:'surface'|'control'|'content';
  readonly parent:Node|null;
  readonly box:{left:number;top:number;width:number;height:number};
  constructor(kind:'surface'|'control'|'content',parent:Node|null=null,box={left:0,top:0,width:300,height:50}){
    super();this.kind=kind;this.parent=parent;this.box=box;
  }
  closest(selector:string):Node|null{
    const find=(test:(node:Node)=>boolean):Node|null=>{for(let node:Node|null=this;node;node=node.parent)if(test(node))return node;return null;};
    if(selector===GLASS_SURFACE_SELECTOR)return find(node=>node.kind==='surface');
    if(selector===GLASS_CONTROL_SELECTOR||selector==='button,summary,[role="button"],a[href]')return find(node=>node.kind==='control');
    if(selector.includes('[data-glass-exclude]'))return find(node=>node.excluded);
    if(selector==='[inert],[hidden],[aria-hidden="true"]')return null;
    throw new Error('Unexpected selector '+selector);
  }
  matches(selector:string){
    if(selector===':focus-visible')return this.focused;
    if(selector===':disabled,[aria-disabled="true"]')return this.disabled;
    throw new Error('Unexpected selector '+selector);
  }
  querySelector(){return this.image?{}:null;}
  getBoundingClientRect(){return this.box;}
}
class Media extends Events{matches=false;set(matches:boolean){this.matches=matches;this.emit('change');}}
function harness(){
  const doc=Object.assign(new Events(),{hidden:false,documentElement:{dataset:{material:'liquid-glass'}},activeElement:null as Node|null});
  const frames=new Map<number,FrameRequestCallback>(),queries=new Map<string,Media>();let serial=0;
  const view=Object.assign(new Events(),{
    matchMedia:(query:string)=>{let value=queries.get(query);if(!value){value=new Media();queries.set(query,value);}return value;},
    requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++serial,callback);return serial;},
    cancelAnimationFrame:(id:number)=>{frames.delete(id);},
  });
  const dispose=installGlassInteractions(doc as unknown as Document,view as unknown as Window);
  const toolbar=new Node('surface');
  const button=new Node('control',toolbar,{left:40,top:10,width:40,height:30});
  const other=new Node('control',toolbar,{left:100,top:10,width:40,height:30});
  const move=(target:Node,x=65,y=20)=>doc.emit('pointermove',{target,clientX:x,clientY:y,pointerType:'mouse'});
  const flush=()=>{const work=[...frames.values()];frames.clear();work.forEach(callback=>callback(0));};
  return{doc,view,frames,queries,dispose,toolbar,button,other,move,flush};
}

test('glass pointer work is coalesced to the latest frame and bounded to its toolbar and control',()=>{
  const h=harness();
  try{
    for(let x=61;x<70;x++)h.move(h.button,x);
    assert.equal(h.frames.size,1);assert.equal(h.button.dataset.glassLit,undefined);
    h.flush();
    assert.equal(h.button.dataset.glassLit,'pointer');assert.equal(h.toolbar.dataset.glassLit,'pointer');
    assert.equal(h.button.values.get('--glass-pointer-x'),'29.0px');assert.equal(h.button.values.get('--glass-pointer-y'),'10.0px');
    assert.equal(h.toolbar.values.get('--glass-pointer-x'),'69.0px');
    h.move(h.other,125);h.flush();
    assert.equal(h.button.dataset.glassLit,undefined);assert.equal(h.button.values.size,0);assert.equal(h.other.dataset.glassLit,'pointer');
    h.move(h.other,900,-80);h.flush();
    assert.equal(h.other.values.get('--glass-pointer-x'),'40.0px');assert.equal(h.other.values.get('--glass-pointer-y'),'0.0px');
  }finally{h.dispose();}
});

test('leaving, removal, document hiding and disposal cannot replay a stale light frame',()=>{
  const h=harness();
  h.move(h.button);h.doc.emit('pointerout',{target:h.button,relatedTarget:null});assert.equal(h.frames.size,0);h.flush();
  assert.equal(h.button.dataset.glassLit,undefined);
  h.move(h.button);h.button.isConnected=false;h.flush();assert.equal(h.button.dataset.glassLit,undefined);h.button.isConnected=true;
  h.move(h.button);h.flush();h.doc.hidden=true;h.doc.emit('visibilitychange');
  assert.equal(h.button.dataset.glassLit,undefined);assert.equal(h.toolbar.values.size,0);
  h.doc.hidden=false;h.move(h.button);h.dispose();h.dispose();h.flush();
  assert.equal(h.doc.count(),0);assert.equal(h.view.count(),0);assert.equal(h.frames.size,0);
  assert.equal(h.button.values.size,0);assert.equal(h.toolbar.dataset.glassLit,undefined);
  assert.ok([...h.queries.values()].every(query=>query.count()===0));
});

test('pointerout retargets a queued frame instead of reviving the old button in the same toolbar',()=>{
  const h=harness();
  try{
    h.move(h.button);
    h.doc.emit('pointerout',{target:h.button,relatedTarget:h.other,clientX:110,clientY:20});
    h.flush();assert.equal(h.button.dataset.glassLit,undefined);assert.equal(h.other.dataset.glassLit,'pointer');
  }finally{h.dispose();}
});

test('accessibility preferences stop pointer tracking while keyboard focus stays static',()=>{
  for(const query of ['(prefers-reduced-motion: reduce)','(prefers-contrast: more)','(prefers-reduced-transparency: reduce)','(pointer: coarse)']){
    const h=harness();
    try{
      h.button.focused=true;h.doc.activeElement=h.button;h.doc.emit('focusin',{target:h.button});
      assert.equal(h.button.dataset.glassLit,'focus');assert.equal(h.toolbar.values.get('--glass-pointer-x'),'50%');
      h.move(h.button);h.flush();assert.equal(h.button.dataset.glassLit,'pointer');
      h.queries.get(query)!.set(true);
      assert.equal(h.button.dataset.glassLit,'focus');assert.equal(h.button.values.get('--glass-pointer-y'),'50%');
      h.move(h.button);assert.equal(h.frames.size,0);assert.equal(h.button.dataset.glassLit,'focus');
      h.doc.emit('focusout');assert.equal(h.button.dataset.glassLit,undefined);
    }finally{h.dispose();}
  }
});

test('geometry handles, image buttons, disabled controls and touch cannot acquire a pointer press',()=>{
  const h=harness();
  try{
    h.button.excluded=true;h.move(h.button);h.flush();assert.equal(h.toolbar.dataset.glassLit,undefined);
    h.button.excluded=false;h.button.image=true;h.move(h.button);h.flush();assert.equal(h.button.dataset.glassLit,undefined);
    h.doc.emit('pointerdown',{target:h.button,pointerType:'mouse',button:0});assert.equal(h.button.dataset.glassPressed,undefined);
    h.button.image=false;h.button.disabled=true;h.doc.emit('pointerdown',{target:h.button,pointerType:'mouse',button:0});assert.equal(h.button.dataset.glassPressed,undefined);
    h.button.disabled=false;h.doc.emit('pointerdown',{target:h.button,pointerType:'touch',button:0});assert.equal(h.button.dataset.glassPressed,undefined);
    h.doc.emit('pointerdown',{target:h.button,pointerType:'mouse',button:0});assert.equal(h.button.dataset.glassPressed,'true');
    h.doc.emit('pointerup');assert.equal(h.button.dataset.glassPressed,undefined);
    h.doc.emit('pointerdown',{target:h.button,pointerType:'mouse',button:0});h.view.emit('blur');assert.equal(h.button.dataset.glassPressed,undefined);
  }finally{h.dispose();}
});
