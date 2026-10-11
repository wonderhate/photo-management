const address=document.getElementById('address'),code=document.getElementById('code'),pair=document.getElementById('pair'),resume=document.getElementById('resume'),error=document.getElementById('error');
window.connectionDone=text=>{pair.disabled=false;resume.disabled=false;error.textContent=text||'';};
pair.onclick=()=>{if(!/^[0-9]{8}$/.test(code.value)){error.textContent='请输入八位配对码';return;}pair.disabled=true;resume.disabled=true;error.textContent='正在连接…';Connect.connect(address.value,code.value);};
resume.onclick=()=>{error.textContent='正在连接…';Connect.resume(address.value);};
