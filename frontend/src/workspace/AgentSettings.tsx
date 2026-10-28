import {useEffect,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import {IS_BROWSER} from '../runtime';
type State={enabled:boolean;scopes:string[];catalog_id:string;endpoint:string;token?:string|null};
export default function AgentSettings({notify}:{notify:(text:string)=>void}){
 const [value,setValue]=useState<State|null>(null),[write,setWrite]=useState(false),[paid,setPaid]=useState(false),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(IS_BROWSER)return;let alive=true;void api<State>('/agent/settings').then(v=>{if(alive){setValue(v);setWrite(v.scopes.includes('write'));setPaid(v.scopes.includes('paid'));}},e=>{if(alive)setError(message(e));});return()=>{alive=false;};},[]);
 async function configure(enabled:boolean){setBusy(true);setError('');try{const v=await api<State>('/agent/settings','PUT',{enabled,scopes:['read',...(write?['write']:[]),...(paid?['paid']:[])]});setValue(v);setToken(v.token||'');window.dispatchEvent(new Event('pc-agent-settings'));notify(enabled?bt('本次会话的MCP已启用。','MCP is enabled for this session.'):bt('MCP已关闭。','MCP is disabled.'));}catch(e){setError(message(e));}finally{setBusy(false);}}
 const connection=token?JSON.stringify({mcpServers:{PhotoCollection:{type:'http',url:location.origin+'/mcp',headers:{Authorization:'Bearer '+token}}}},null,2):'';
 return <section className="settings-card"><h3>{bt('本地Agent / MCP','Local Agent / MCP')}</h3>{IS_BROWSER?<p>{bt('MCP需要Windows桌面或本机服务。当前纯网页照片库不开放网络连接。','MCP requires the Windows app or local service. This browser library does not expose a network connection.')}</p>:<>
 <p>{bt('默认关闭，仅允许本机连接。启用只对本次运行有效，重启后关闭。每个修改、导出或云端请求仍需在活动中心单独确认。','Off by default and limited to loopback connections. Access ends when the app restarts. Every modification, export or cloud request still needs individual approval in the activity center.')}</p>
 {error&&<p role="alert" className="error-box">{error}</p>}
 <p role="status">{value?.enabled?bt('已启用','Enabled'):bt('已关闭','Disabled')}</p>
 <label className="check"><input type="checkbox" checked={write} onChange={e=>setWrite(e.target.checked)}/>{bt('允许提交修改与导出申请','Allow requests to modify and export')}</label>
 <label className="check"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/>{bt('允许提交国内AI上传与计费申请','Allow domestic AI upload and billing requests')}</label>
 <div className="button-row"><button disabled={busy||!value} onClick={()=>void configure(true)}>{value?.enabled?bt('更新权限并轮换令牌','Update permissions and rotate token'):bt('启用本次会话','Enable this session')}</button>{value?.enabled&&<button className="danger" disabled={busy} onClick={()=>void configure(false)}>{bt('关闭并撤销待处理申请','Disable and revoke pending requests')}</button>}</div>
 <p className="muted">{bt('更新权限会撤销旧令牌及待处理请求。令牌仅在此显示，不写入图库或设置备份；请只交给可信的本机Agent。','Changing permissions revokes the old token and pending requests. The token is shown here only and is excluded from library and settings backups. Share it only with a trusted local Agent.')}</p>
 {connection&&<details><summary>{bt('客户端连接配置（含令牌）','Client connection configuration (contains token)')}</summary><textarea readOnly rows={10} aria-label={bt('MCP连接配置','MCP connection configuration')} value={connection}/><button onClick={()=>{void navigator.clipboard.writeText(connection).then(()=>notify(bt('已复制连接配置','Connection configuration copied')),()=>setError(bt('复制失败，请手动复制。','Copy failed. Please copy manually.')));}}>{bt('复制配置','Copy configuration')}</button></details>}
 </>}</section>;
}
