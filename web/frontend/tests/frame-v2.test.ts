import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FRAME_TEMPLATES,frameLayers,frameGeometry,validateFrame,validateUserFrame,frameText} from '../src/core/frame-v2.ts';
import type {FrameDocument} from '../src/core/frame-v2.ts';

function document(index=0):FrameDocument{return {version:2,template:structuredClone(FRAME_TEMPLATES[index]),margin:1,text_scale:1,tokens:{camera_model:'相机 Camera',lens_model:'35mm lens',focal:'35mm',aperture:'f/2.8',shutter:'1/125s',iso:'ISO 200',author:'wonder',title:'山与海'},logo:null,logo_mode:'none',logo_tone:'original'};}
test('all 22 frame plans keep layout at preview and full export sizes',()=>{
  assert.equal(FRAME_TEMPLATES.length,22);
  for(const [width,height] of [[640,480],[480,640],[1200,240]])for(let i=0;i<22;i++){
    const d=document(i),full=frameLayers(width,height,d),preview=frameLayers(width,height,d,320);
    assert.deepEqual(preview.layers,full.layers);assert.equal(preview.fullWidth,full.fullWidth);assert.equal(preview.fullHeight,full.fullHeight);
    assert.ok(Math.max(preview.width,preview.height)<=320);
  }
});
test('frame snapshots reject malformed values and never silently downsize unbounded exports',()=>{
  for(const patch of [{version:3},{margin:true},{tokens:{'private-path':'value'}},{logo_mode:'manual'},{logo:null,logo_mode:'unknown'}])assert.throws(()=>validateFrame({...document(),...patch}));
  const d=document();(d.template.canvas as any).scrim=null;assert.throws(()=>validateFrame(d));
  assert.throws(()=>frameGeometry(10000,10000,document()));assert.ok(frameGeometry(10000,10000,document(),4096).width<=4096);
  assert.doesNotThrow(()=>validateFrame({...document(),tokens:{title:'📷 山与海'}}));
  assert.throws(()=>validateFrame({...document(),tokens:{title:'\ud800'}}));
});
test('user templates store anchors and tokens without photo-specific metadata or paths',()=>{
  const d=document(),record={version:2,id:'frame-personal',name:'My frame',template:d.template,margin:1,text_scale:1};
  validateUserFrame(record);assert.throws(()=>validateUserFrame({...record,file_path:'private.jpg'}));
  assert.equal(frameText({type:'text',anchor:{region:'bottom',h:'center',v:'center'},style:{size:.02},content:'{camera_model} {unknown}'},{camera_model:'My camera'}),'My camera ');
});
