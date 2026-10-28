import {useRef,useState} from 'react';
import {Camera} from 'lucide-react';
import {bt,browserError} from '../browser/text';
import {cameraDisplayName,parseCameraNameFile,sameCamera,validCameraAliases} from '../core/camera-names';
import type {CameraAlias} from '../core/camera-names';
import {useCameraNames} from './CameraNames';

export default function CameraNameSettings({notify}:{notify:(text:string)=>void}){
  const {aliases,ready,error,save}=useCameraNames(),[make,setMake]=useState(''),[model,setModel]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),fileInput=useRef<HTMLInputElement>(null);
  async function persist(values:CameraAlias[]){setBusy(true);try{if(!validCameraAliases(values))throw new Error('Invalid camera name mappings.');await save(values);notify(bt('相机显示名称已保存','Camera display names saved'));}catch(e){notify(browserError(e));}finally{setBusy(false);}}
  const candidate={make:make.trim(),model:model.trim(),name:name.trim()};
  return <section className="settings-card" id="camera-name-settings"><header><Camera size={20}/><div><h3>{bt('相机显示名称','Camera display names')}</h3><p>{bt('别名优先于内置名称。原始 EXIF、筛选和已有作品保持不变。','Your aliases override built-in names. Original EXIF, filters and existing artworks stay unchanged.')}</p></div></header>
    {error&&<p role="alert" className="error-box">{browserError(error)}</p>}
    <fieldset disabled={!ready||busy} style={{border:0,padding:0,margin:0}}><div className="three-columns">
      <label>{bt('EXIF 品牌（可留空）','EXIF make (optional)')}<input maxLength={200} value={make} onChange={e=>setMake(e.target.value)}/></label>
      <label>{bt('EXIF 机型','EXIF model')}<input maxLength={200} value={model} onChange={e=>setModel(e.target.value)}/></label>
      <label>{bt('显示名称','Display name')}<input maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
    </div><p className="muted">{bt('默认名称：','Default name: ')}{cameraDisplayName(make,model)||'—'}</p>
    <div className="button-row"><button disabled={!validCameraAliases([candidate])} onClick={()=>void persist([...aliases.filter(a=>!sameCamera(a,candidate)),candidate])}>{bt('保存别名','Save alias')}</button>
      <button onClick={()=>fileInput.current?.click()}>{bt('导入名称映射','Import name mappings')}</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);void (async()=>{try{if(file.size>300000)throw new Error('Invalid camera name mappings.');const imported=parseCameraNameFile(await file.text()),merged=[...aliases.filter(a=>!imported.some(b=>sameCamera(a,b))),...imported];await persist(merged);}catch(error){notify(browserError(error));}finally{setBusy(false);}})();}}/></div>
    <p className="muted">{bt('映射文件格式：version 为 1，aliases 为 make、model、name 对象数组。导入时仅替换同一品牌和机型的别名，最多 500 项。','Mapping format: version 1, with an aliases array of make, model and name objects. Import replaces matching make/model aliases only, up to 500 entries.')}</p>
    {aliases.map((a,i)=><div className="plugin-row" key={i}><span><b>{a.name}</b><small> · {a.make} / {a.model}</small></span><div className="button-row"><button onClick={()=>{setMake(a.make);setModel(a.model);setName(a.name);}}>{bt('编辑','Edit')}</button><button onClick={()=>void persist(aliases.filter((_,index)=>index!==i))}>{bt('恢复默认名称','Restore default name')}</button></div></div>)}
    </fieldset></section>;
}
