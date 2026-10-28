// Delegated lighting for the public site only. No React lifecycle or network work.
(()=>{
  const root='.public-site,.windows-download';
  const surfaces='.hdr,.public-header,.contact,.tile-more,.feat article,.notes-grid article,.notes-contact,.public-search,.public-lumina,.public-photo-info,.public-lightbox-bar,.download-header,.download-package,.download-developer,.download-faq,.download-guide,.download-features article,.download-hero-art';
  const preferences=['(prefers-reduced-motion: reduce)','(prefers-reduced-transparency: reduce)','(prefers-contrast: more)','(forced-colors: active)','(pointer: coarse)'].map(query=>matchMedia(query));
  let lit=null,frame=0,pending=null;
  function clear(){
    cancelAnimationFrame(frame);frame=0;pending=null;
    if(lit){lit.removeAttribute('data-site-glass-lit');lit.style.removeProperty('--site-light-x');lit.style.removeProperty('--site-light-y');lit=null;}
  }
  function draw(){
    frame=0;const sample=pending;pending=null;
    if(!sample)return;
    const {target,x,y}=sample;
    if(!target.isConnected){clear();return;}
    if(lit!==target){clear();lit=target;lit.setAttribute('data-site-glass-lit','');}
    const box=target.getBoundingClientRect();
    target.style.setProperty('--site-light-x',`${Math.round(x-box.left)}px`);
    target.style.setProperty('--site-light-y',`${Math.round(y-box.top)}px`);
  }
  document.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch'||preferences.some(media=>media.matches)){clear();return;}
    const origin=event.target instanceof Element?event.target:null;
    const target=origin?.closest(root)?origin.closest(surfaces):null;
    if(!target){clear();return;}
    pending={target,x:event.clientX,y:event.clientY};
    if(!frame)frame=requestAnimationFrame(draw);
  },{passive:true});
  document.addEventListener('pointerout',event=>{if(!event.relatedTarget)clear();},{passive:true});
  document.addEventListener('visibilitychange',clear);
  window.addEventListener('blur',clear);
  window.addEventListener('pagehide',clear);
  window.addEventListener('scroll',clear,{passive:true,capture:true});
  for(const preference of preferences)preference.addEventListener('change',()=>{if(preferences.some(media=>media.matches))clear();});
})();
