import {useState,useEffect} from 'react';
import {Users,Plus,Edit2,Trash2,ScanFace} from 'lucide-react';
import {api,message} from './api';
import {Empty,Modal} from './components';
import type {FacePerson} from './types';

export default function FacesPage({notify}:{notify:(msg:string)=>void}){
  const [persons,setPersons]=useState<FacePerson[]>([]);
  const [loading,setLoading]=useState(true);
  const [available,setAvailable]=useState(false);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editName,setEditName]=useState('');
  const [newName,setNewName]=useState('');
  const [showAdd,setShowAdd]=useState(false);

  useEffect(()=>{loadData()},[]);

  async function loadData(){
    try{
      const status=await api<{available:boolean}>('/faces/status');
      setAvailable(status.available);
      if(status.available){const data=await api<FacePerson[]>('/faces/persons');setPersons(data)}
    }catch(e){notify(message(e))}finally{setLoading(false)}
  }

  async function handleAdd(){
    if(!newName.trim())return;
    try{await api('/faces/persons','POST',{name:newName.trim()});setNewName('');setShowAdd(false);await loadData();notify('人物已创建')}
    catch(e){notify(message(e))}
  }

  async function handleRename(id:string){
    if(!editName.trim())return;
    try{await api('/faces/persons/'+id,'PATCH',{name:editName.trim()});setEditingId(null);setEditName('');await loadData();notify('已重命名')}
    catch(e){notify(message(e))}
  }

  async function handleDelete(person:FacePerson){
    if(!confirm(`删除人物「${person.name}」？照片不会被删除。`))return;
    try{await api('/faces/persons/'+person.id,'DELETE');await loadData();notify('已删除')}
    catch(e){notify(message(e))}
  }

  if(loading)return <p className="loading">加载中…</p>;

  if(!available)return <div className="face-setup-notice">
    <ScanFace size={48} style={{color:'#c6ae86',marginBottom:16}}/>
    <h2>人脸识别功能不可用</h2>
    <p className="muted">需要安装 face-recognition 库才能使用人脸识别功能</p>
    <div className="error-box">
      <p style={{marginBottom:8}}><b>安装方法：</b></p>
      <code>.\.venv\Scripts\pip.exe install face-recognition</code>
      <p className="muted" style={{marginTop:10}}>注意：face-recognition 需要 CMake 和 Visual Studio Build Tools</p>
    </div>
  </div>;

  return <div className="faces-page">
    <div className="section-intro">
      <div><span className="eyebrow">FACES YOU KNOW</span><h2>人物相册</h2><p>{persons.length} 个人物 · 自动识别照片中的人脸</p></div>
      <button className="primary" onClick={()=>setShowAdd(true)}><Plus size={16}/>添加人物</button>
    </div>

    {!persons.length?<Empty title="还没有人物">点击「添加人物」开始创建人物相册。</Empty>:
    <div className="faces-grid">{persons.map(person=><article className="face-card" key={person.id}>
      <div className="face-card-avatar"><Users size={40}/></div>
      <div className="face-card-info">
        {editingId===person.id?<div className="face-inline-edit">
          <input value={editName} onChange={e=>setEditName(e.target.value)} autoFocus onKeyDown={e=>e.key==='Enter'&&handleRename(person.id)}/>
          <div className="row"><button className="primary" onClick={()=>handleRename(person.id)}>保存</button><button onClick={()=>{setEditingId(null);setEditName('')}}>取消</button></div>
        </div>:<>
          <h3 title={person.name}>{person.name}</h3>
          <p>{person.photo_count} 张照片</p>
          <div className="face-card-actions">
            <button onClick={()=>{setEditingId(person.id);setEditName(person.name)}}><Edit2 size={12}/>重命名</button>
            <button className="danger" onClick={()=>handleDelete(person)}><Trash2 size={12}/>删除</button>
          </div>
        </>}
      </div>
    </article>)}</div>}

    {showAdd&&<Modal title="添加人物" onClose={()=>{setShowAdd(false);setNewName('')}}>
      <div className="batch-edit-content">
        <div className="batch-edit-section"><span>人物名称</span><input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="输入人物名称" autoFocus onKeyDown={e=>e.key==='Enter'&&handleAdd()}/></div>
        <footer className="modal-footer"><button onClick={()=>{setShowAdd(false);setNewName('')}}>取消</button><button className="primary" onClick={handleAdd}>创建</button></footer>
      </div>
    </Modal>}
  </div>;
}
