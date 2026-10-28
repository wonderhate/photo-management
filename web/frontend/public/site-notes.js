// Small enhancements for the static introduction pages; no third-party requests.
const page=document.querySelector('.public-notes'),en=document.documentElement.lang==='en';
try{page.dataset.theme=localStorage.getItem('theme')==='light'?'light':'dark';localStorage.setItem('lang',en?'en':'zh');}catch{}
const theme=document.getElementById('notes-theme');
function themeLabel(){theme.setAttribute('aria-label',en?(page.dataset.theme==='light'?'Switch to dark theme':'Switch to light theme'):(page.dataset.theme==='light'?'切换到暗色主题':'切换到亮色主题'));}
themeLabel();theme.addEventListener('click',()=>{page.dataset.theme=page.dataset.theme==='light'?'dark':'light';try{localStorage.setItem('theme',page.dataset.theme);}catch{}themeLabel();});
document.querySelector('[data-copy-qq]')?.addEventListener('click',async event=>{
  const status=document.getElementById('contact-status');
  try{await navigator.clipboard.writeText(event.currentTarget.dataset.copyQq);status.textContent=en?'QQ number copied. Please mention Lumina when you say hello.':'QQ 已复制，添加时可以备注「来自光影集」。';}
  catch{status.textContent=en?'Please select and copy the QQ number above.':'请手动选择并复制上方 QQ 号码。';}
});
