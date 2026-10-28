// Pointer lighting is presentation-only: delegated listeners never change a
// control's input, focus, selection, capture, or application state.
export const GLASS_SURFACE_SELECTOR=[
  '[data-liquid-glass]',
  '.topbar','.workspace-subnav','.photo-inspector','.detail-info',
  '.photo-viewer .photo-detail > aside','.photo-viewer .viewer-top','.photo-viewer .viewer-bottom','.viewer-tools',
  '.viewer-toolbar','.viewer-filmstrip','.exhibit-controls',
  '.modal','.video-dialog','.activity-panel','.edit-controls','.art-controls','.settings-card','.settings-section',
  '.command-menu','.editor-toolbar','.draft-editor-bar','.art-tabs','.filter-panel','.autocomplete-panel',
  '.recent-panel','.hover-preview','.public-photo-info','.public-lightbox-bar','.public-lightbox-navigation','.public-thumbnails',
  '.display-panel','.facet-popover','.facet-workbench','.library-toolbar','.selection-toolbar',
  '.chart-panel','.editor-panel','.collage-controls','.split-options','.stage-toolbar','.collage-toolbar','.split-toolbar',
  '.album-list-toolbar','.album-overview-controls','.timeline-sidebar','.map-controls','.art-task',
  '.public-header','.public-search','.public-cover-controls',
].join(',');

export const GLASS_CONTROL_SELECTOR=[
  'button','a[href]','summary','select','textarea',
  'input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
  '[role="button"]',
].join(',');

const excludedSelector=[
  '[data-glass-exclude]','[data-liquid-glass="off"]','[inert]',
  '.photo-image','.photo-card','.lut-thumbnail','.lut-choice','.art-work-open',
  '.map-cluster','.leaflet-marker-icon','.leaflet-control',
  '.layer-handle','.text-handle','.crop-handle','.composition-handle','.split-handle',
  '.collage-slot','.collage-canvas','.layer-canvas','.text-canvas','.composition-canvas','.split-canvas',
  '.color-dot','.color-dots','.rating-stars','.color-swatch','.palette-swatch','.palette-swatches',
  '.collage-swatch','.collage-cells','.public-thumbnails','.viewer-filmstrip','.filmstrip',
  '.art-picker-grid','.ai-results','.ai-photo-picker',
].join(',');

interface PointerPosition {target:EventTarget|null;x:number;y:number}

function element(target:EventTarget|null):Element|null{
  return target&&typeof (target as Element).closest==='function'?target as Element:null;
}
function styled(node:Element|null):HTMLElement|null{
  return node&&'style' in node?node as HTMLElement:null;
}
function controlsDisabled(node:Element){
  return node.matches(':disabled,[aria-disabled="true"]')||!!node.closest('[inert],[hidden],[aria-hidden="true"]');
}
function safeControl(node:Element|null):HTMLElement|null{
  if(!node||node.closest(excludedSelector)||controlsDisabled(node))return null;
  // Image cards, LUT previews, and geometric canvases are content rather than
  // glass controls. They must not repaint an illumination layer on every move.
  if(node.querySelector('img,picture,canvas,video'))return null;
  return styled(node);
}
function targets(target:EventTarget|null):HTMLElement[]{
  const node=element(target);if(!node||node.closest(excludedSelector))return [];
  const control=safeControl(node.closest(GLASS_CONTROL_SELECTOR));
  const surface=styled(node.closest(GLASS_SURFACE_SELECTOR));
  return surface&&surface!==control?[surface,...(control?[control]:[])]:control?[control]:surface?[surface]:[];
}

/** Install once before mounting React. Calling the returned function is safe
 * more than once. The document/window arguments support isolated acceptance. */
export function installGlassInteractions(doc:Document=document,view:Window=window):()=>void{
  const media=[
    view.matchMedia('(prefers-reduced-motion: reduce)'),
    view.matchMedia('(prefers-contrast: more)'),
    view.matchMedia('(prefers-reduced-transparency: reduce)'),
    view.matchMedia('(pointer: coarse)'),
  ];
  const pointer=new Map<HTMLElement,{x:string;y:string}>();
  let focused:HTMLElement[]=[],pressed:HTMLElement|null=null,pending:PointerPosition|null=null,frame:number|null=null,disposed=false;
  const enabled=()=>!disposed&&!doc.hidden&&doc.documentElement.dataset.material==='liquid-glass';
  const tracking=()=>enabled()&&!media.some(query=>query.matches);
  function paint(node:HTMLElement){
    const position=pointer.get(node);
    if(position){
      node.dataset.glassLit='pointer';
      node.style.setProperty('--glass-pointer-x',position.x);node.style.setProperty('--glass-pointer-y',position.y);
    }else if(focused.includes(node)){
      node.dataset.glassLit='focus';
      node.style.setProperty('--glass-pointer-x','50%');node.style.setProperty('--glass-pointer-y','50%');
    }else{
      delete node.dataset.glassLit;
      node.style.removeProperty('--glass-pointer-x');node.style.removeProperty('--glass-pointer-y');
    }
  }
  function cancelFrame(){if(frame!==null)view.cancelAnimationFrame(frame);frame=null;pending=null;}
  function clearPointer(){
    cancelFrame();const previous=[...pointer.keys()];pointer.clear();previous.forEach(paint);
  }
  function clearPressed(){if(pressed)delete pressed.dataset.glassPressed;pressed=null;}
  function clearFocus(){const previous=focused;focused=[];previous.forEach(paint);}
  function clear(){clearPointer();clearPressed();clearFocus();}
  function updateFocus(target:EventTarget|null){
    const node=element(target),next=enabled()&&node?.matches(':focus-visible')?targets(target):[];
    const previous=focused;focused=next;new Set([...previous,...next]).forEach(paint);
  }
  function flush(){
    frame=null;const latest=pending;pending=null;
    if(!latest||!tracking()){clearPointer();return;}
    const next=targets(latest.target).filter(node=>node.isConnected),previous=[...pointer.keys()];
    pointer.clear();
    for(const node of next){
      const box=node.getBoundingClientRect();
      // Do not retain an invisible/replaced control, or invalid coordinates
      // from a cancelled pointer. The map remains bounded to two elements.
      if(box.width<=0||box.height<=0)continue;
      const x=Math.max(0,Math.min(box.width,latest.x-box.left));
      const y=Math.max(0,Math.min(box.height,latest.y-box.top));
      pointer.set(node,{x:x.toFixed(1)+'px',y:y.toFixed(1)+'px'});
    }
    new Set([...previous,...pointer.keys()]).forEach(paint);
  }
  function move(event:PointerEvent){
    if(!tracking()||event.pointerType==='touch'||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)){clearPointer();return;}
    pending={target:event.target,x:event.clientX,y:event.clientY};
    if(frame===null)frame=view.requestAnimationFrame(flush);
  }
  function out(event:PointerEvent){
    const next=new Set(targets(event.relatedTarget));
    if(!next.size){clearPointer();clearPressed();return;}
    // Clear the old button immediately while retaining its shared toolbar.
    // The following pointerover/move frame positions the new light source.
    for(const node of pointer.keys())if(!next.has(node)){pointer.delete(node);paint(node);}
    if(pending){
      if(tracking()&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))pending={target:event.relatedTarget,x:event.clientX,y:event.clientY};
      else cancelFrame();
    }
    if(pressed&&!next.has(pressed))clearPressed();
  }
  function down(event:PointerEvent){
    clearPressed();if(!tracking()||event.pointerType==='touch'||event.button!==0)return;
    const control=safeControl(element(event.target)?.closest(GLASS_CONTROL_SELECTOR)||null);
    if(control){pressed=control;control.dataset.glassPressed='true';}
  }
  function keydown(event:KeyboardEvent){
    if(event.repeat||event.defaultPrevented||!enabled()||!['Enter',' '].includes(event.key))return;
    const control=safeControl(element(event.target)?.closest('button,summary,[role="button"],a[href]')||null);
    if(control){clearPressed();pressed=control;control.dataset.glassPressed='true';}
  }
  const keyup=(event:KeyboardEvent)=>{if(['Enter',' '].includes(event.key))clearPressed();};
  const focusin=(event:FocusEvent)=>updateFocus(event.target);
  const focusout=()=>clearFocus();
  const cancelled=()=>{clearPointer();clearPressed();};
  const geometry=()=>clearPointer();
  const preference=()=>{clearPointer();clearPressed();updateFocus(doc.activeElement);};
  const visibility=()=>{if(doc.hidden)clear();else updateFocus(doc.activeElement);};
  const options={capture:true,passive:true} as const;
  doc.addEventListener('pointerover',move,options);doc.addEventListener('pointermove',move,options);
  doc.addEventListener('pointerout',out,options);doc.addEventListener('pointerdown',down,options);
  doc.addEventListener('pointerup',clearPressed,options);doc.addEventListener('pointercancel',cancelled,options);
  doc.addEventListener('focusin',focusin,true);doc.addEventListener('focusout',focusout,true);
  doc.addEventListener('keydown',keydown,true);doc.addEventListener('keyup',keyup,true);
  doc.addEventListener('scroll',geometry,options);doc.addEventListener('visibilitychange',visibility);
  view.addEventListener('blur',clear);view.addEventListener('resize',geometry,{passive:true});
  media.forEach(query=>query.addEventListener('change',preference));
  updateFocus(doc.activeElement);
  return()=>{
    if(disposed)return;disposed=true;clear();
    doc.removeEventListener('pointerover',move,true);doc.removeEventListener('pointermove',move,true);
    doc.removeEventListener('pointerout',out,true);doc.removeEventListener('pointerdown',down,true);
    doc.removeEventListener('pointerup',clearPressed,true);doc.removeEventListener('pointercancel',cancelled,true);
    doc.removeEventListener('focusin',focusin,true);doc.removeEventListener('focusout',focusout,true);
    doc.removeEventListener('keydown',keydown,true);doc.removeEventListener('keyup',keyup,true);
    doc.removeEventListener('scroll',geometry,true);doc.removeEventListener('visibilitychange',visibility);
    view.removeEventListener('blur',clear);view.removeEventListener('resize',geometry);
    media.forEach(query=>query.removeEventListener('change',preference));
  };
}
