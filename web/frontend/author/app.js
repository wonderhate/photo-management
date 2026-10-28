const session=location.hash.slice(1),$=id=>document.getElementById(id);
let catalog,dirty=false,busy=false,polling=false,jobBusy=false,uploadTarget='all';
async function api(name,data,method='POST'){
  const r=await fetch('/author/api/'+name,{method,headers:{Authorization:'Bearer '+session,...(data instanceof Blob?{'Content-Type':'image/jpeg'}:{'Content-Type':'application/json'})},body:method==='GET'?undefined:data instanceof Blob?data:JSON.stringify(data||{})});
  const body=await r.json();if(!r.ok)throw Error(body.error||'操作失败。');return body;
}
function error(e){$('error').textContent=e.message;}
function boundary(el,value){el.dataset.boundary=value?'1':'';el.disabled=busy||value;}
function lock(value){busy=value;document.body.classList.toggle('busy',value);for(const el of document.querySelectorAll('input,textarea,button,select'))el.disabled=value||el.dataset.boundary==='1';}
function changed(){dirty=true;$('download').hidden=true;$('status').textContent='有未保存的改动。';}
function label(text,value,max,change,multiline=false){const l=document.createElement('label');l.textContent=text;const el=document.createElement(multiline?'textarea':'input');el.value=value;el.disabled=busy;el.maxLength=max;el.addEventListener('input',()=>{change(el.value);changed();});l.append(el);return l;}
function button(text,action,disabled=false){const b=document.createElement('button');b.type='button';b.textContent=text;boundary(b,disabled);b.onclick=()=>{if(busy)return;try{action();}catch(e){error(e);}};return b;}
function thumbnail(p){const image=document.createElement('img');image.alt=p.title||'展示照片';fetch('/author/api/image/'+p.thumbnail.split('/').at(-1),{headers:{Authorization:'Bearer '+session}}).then(async r=>{if(!r.ok)return;const url=URL.createObjectURL(await r.blob());image.onload=image.onerror=()=>URL.revokeObjectURL(url);image.src=url;}).catch(()=>{});return image;}
function orderButtons(list,i,remove){const row=document.createElement('div');row.className='row';for(const [text,step] of [['上移',-1],['下移',1],['移除',0]])row.append(button(text,()=>{if(step)[list[i],list[i+step]]=[list[i+step],list[i]];else remove();changed();render();},step<0&&i===0||step>0&&i===list.length-1));return row;}
function chooseUpload(target){uploadTarget=target;$('files').click();}
function selectionEditor(container,ids,max,target,uploadLabel,pickerLabel){
  container.replaceChildren();const toolbar=document.createElement('div');toolbar.className='row';
  toolbar.append(button(uploadLabel,()=>chooseUpload(target),ids.length>=max));
  const select=document.createElement('select');select.setAttribute('aria-label',pickerLabel);const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=pickerLabel;select.append(placeholder);
  catalog.photos.filter(p=>!ids.includes(p.id)).forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.title||'作品 '+(catalog.photos.indexOf(p)+1);select.append(o);});
  boundary(select,ids.length>=max||select.options.length===1);toolbar.append(select,button('加入已上传照片',()=>{if(!select.value)throw Error('请先选择一张已上传照片。');ids.push(select.value);changed();render();},ids.length>=max||select.options.length===1));
  const count=document.createElement('span');count.textContent=ids.length+' / '+max;toolbar.append(count);container.append(toolbar);
  const cards=document.createElement('div');cards.className='selection-grid';
  ids.forEach((id,i)=>{const p=catalog.photos.find(p=>p.id===id);if(!p)return;const card=document.createElement('article');card.className='selection-card';card.dataset.photoId=id;const title=document.createElement('p');title.textContent=String(i+1).padStart(2,'0')+' / '+(p.title||'未命名作品');card.append(thumbnail(p),title,orderButtons(ids,i,()=>ids.splice(i,1)));cards.append(card);});
  container.append(cards);
}
function render(){
  $('title').value=catalog.title;$('intro').value=catalog.intro;$('photos').replaceChildren();$('empty').hidden=!!catalog.photos.length;$('count').textContent=catalog.photos.length+' 张公开照片';
  catalog.photos.forEach((p,i)=>{const row=document.createElement('article');row.className='photo';const fields=document.createElement('div');
    fields.append(label('标题',p.title,160,v=>p.title=v),label('说明',p.description,2000,v=>p.description=v,true),label('标签（逗号分隔）',p.tags.join(', '),1600,v=>p.tags=v.split(/[,，]/).map(s=>s.trim()).filter(Boolean)));
    const rank=document.createElement('p');rank.className='muted';rank.textContent=String(i+1).padStart(2,'0')+(catalog.coverIds.includes(p.id)?' · 轮播':'')+(catalog.featuredIds.includes(p.id)?' · 精选':'');
    fields.append(rank,orderButtons(catalog.photos,i,()=>{catalog.photos.splice(i,1);catalog.coverIds=catalog.coverIds.filter(id=>id!==p.id);catalog.featuredIds=catalog.featuredIds.filter(id=>id!==p.id);for(const a of catalog.albums)a.photoIds=a.photoIds.filter(id=>id!==p.id);}));
    row.append(thumbnail(p),fields);$('photos').append(row);
  });
  selectionEditor($('cover-editor'),catalog.coverIds,6,'covers','上传轮播照片','选择已上传照片加入轮播');
  selectionEditor($('featured-editor'),catalog.featuredIds,12,'featured','上传精选照片','选择已上传照片加入精选');
  $('album-editors').replaceChildren();$('no-albums').hidden=!!catalog.albums.length;boundary($('create-album'),catalog.albums.length>=200);
  catalog.albums.forEach((a,i)=>{const card=document.createElement('article');card.className='album-editor';card.dataset.albumId=a.id;const heading=document.createElement('h3');heading.textContent='影集 '+(i+1);
    card.append(heading,label('影集名称',a.title,160,v=>a.title=v),label('影集介绍',a.description,2000,v=>a.description=v,true));
    const actions=orderButtons(catalog.albums,i,()=>catalog.albums.splice(i,1));actions.lastChild.textContent='删除影集（保留照片）';card.append(actions);
    const picker=document.createElement('div');selectionEditor(picker,a.photoIds,2000,a.id,'上传照片到此影集','选择已上传照片加入此影集');card.append(picker);$('album-editors').append(card);
  });
}
async function save(){
  catalog.title=$('title').value;catalog.intro=$('intro').value;
  if(catalog.albums.some(a=>!a.title.trim()))throw Error('请填写每个影集的名称。');
  await api('draft',catalog);dirty=false;$('status').textContent='草稿已保存在本机。';
}
async function run(task){if(busy)return;lock(true);$('error').textContent='';try{await task();}catch(e){error(e);}finally{lock(jobBusy);}}
async function state(){const s=await api('state',null,'GET');$('auth-state').textContent=s.credential?'发布凭据已配置 · '+s.project:'尚未配置发布凭据。预览与保存草稿仍然可用。';if(s.credentialWarning)$('credential-feedback').textContent=s.credentialWarning;$('remember').dataset.boundary=s.canRemember?'':'1';$('remember').disabled=!s.canRemember;if(!s.canRemember)$('remember').checked=false;
  $('download').hidden=!s.release;if(s.release)$('download').href='/author/download#'+session;
  jobBusy=!!s.job?.busy;if(s.job){$('status').textContent=s.job.message;if(s.job.error)$('error').textContent=s.job.error;lock(jobBusy);if(jobBusy&&!polling){polling=true;setTimeout(async()=>{polling=false;try{await state();}catch(e){lock(false);error(e);}},1800);}}
  return s;
}
async function derivative(bitmap,edge){const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));c.width=c.height=1;if(!blob)throw Error('无法创建展示副本。');return api('image',blob);}
$('choose-files').onclick=()=>chooseUpload('all');
$('files').onchange=()=>void run(async()=>{
  const files=[...$('files').files],target=uploadTarget;
  const ids=target==='covers'?catalog.coverIds:target==='featured'?catalog.featuredIds:target==='all'?null:catalog.albums.find(a=>a.id===target)?.photoIds;
  const max=target==='covers'?6:target==='featured'?12:2000;
  try{
    if(target!=='all'&&!ids)throw Error('目标影集不存在，请重新选择。');
    if(catalog.photos.length+files.length>2000||ids&&ids.length+files.length>max)throw Error('本次选择超过数量限制，请减少照片或先移出已有照片。');
    for(let i=0;i<files.length;i++){
      const f=files[i];if(f.size>128*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type))throw Error('请选择不超过 128 MiB 的 JPEG、PNG 或 WebP。');
      $('status').textContent='正在准备展示副本 '+(i+1)+' / '+files.length;
      const bitmap=await createImageBitmap(f,{imageOrientation:'from-image'});
      try{
        if(bitmap.width*bitmap.height>150000000)throw Error('照片像素过大，请先导出较小的展示图片。');
        const photo=await derivative(bitmap,2560),thumb=await derivative(bitmap,640);
        if(!catalog.photos.some(p=>p.id===photo.id))catalog.photos.push({id:photo.id,title:'',description:'',tags:[],src:photo.src,thumbnail:thumb.src,width:photo.width,height:photo.height});
        if(ids&&!ids.includes(photo.id))ids.push(photo.id);
        if(target==='all')for(const [selection,limit] of [[catalog.coverIds,6],[catalog.featuredIds,12]])if(selection.length<limit&&!selection.includes(photo.id))selection.push(photo.id);
      }finally{bitmap.close();}
      changed();
    }
    await save();
  }finally{render();$('files').value='';if(target==='all')$('photo-details').open=true;}
});
$('create-album').onclick=()=>{if(busy)return;const title=$('new-album-title').value.trim();if(!title){error(Error('请先填写新影集名称。'));return;}if(catalog.albums.length>=200){error(Error('最多建立 200 个公开影集。'));return;}catalog.albums.push({id:'collection-'+crypto.randomUUID(),title,description:'',photoIds:[]});$('new-album-title').value='';changed();render();};
for(const el of document.querySelectorAll('[data-scroll]'))el.onclick=()=>$(el.dataset.scroll).scrollIntoView();
$('title').oninput=()=>{catalog.title=$('title').value;changed();};$('intro').oninput=()=>{catalog.intro=$('intro').value;changed();};
$('save').onclick=()=>void run(async()=>{await save();render();});
for(const action of ['build','publish'])$(action).onclick=()=>void run(async()=>{await save();await api(action);await state();});
$('set-credential').onclick=()=>void run(async()=>{const input=$('credential');$('credential-feedback').textContent='正在核对腾讯云项目权限，请稍候…';try{const result=await api('credential',{token:input.value.trim(),remember:$('remember').checked});input.value='';await state();$('credential-feedback').textContent=$('status').textContent=result.warning||'已核对现有项目，发布凭据可以使用。';}catch(e){$('credential-feedback').textContent=e.message;throw e;}});
$('forget').onclick=()=>void run(async()=>{await api('credential',{token:''});$('credential').value='';await state();});
$('download').onclick=async e=>{e.preventDefault();try{const r=await fetch('/author/api/download',{headers:{Authorization:'Bearer '+session}});if(!r.ok)throw Error('请先生成网站包。');const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download='Lumina-website.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){error(e);}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
try{
  if(!/^[a-f0-9]{64}$/.test(session))throw Error('请使用启动程序显示的完整作者地址（包含 # 后面的本机会话码）。');
  const s=await state();catalog=s.catalog;
  if(catalog.coverIds===undefined){if(!catalog.featuredIds.length)catalog.featuredIds=catalog.photos.slice(0,12).map(p=>p.id);catalog.coverIds=catalog.featuredIds.slice(0,6);}
  render();lock(jobBusy);
}catch(e){lock(true);error(e);}
