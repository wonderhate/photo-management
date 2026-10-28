import {useEffect,useState} from 'react';
import {api,message} from '../api';
import {bt} from '../browser/text';
import type {AgentReview} from '../core/agent';
import {agentLabels} from '../core/agent';
export default function AgentApproval({id,status,review,digest,onChanged,notify}:{id:string;status:string;review?:AgentReview;digest?:string;onChanged:()=>void;notify:(text:string)=>void}){
 const [paid,setPaid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setPaid(false);setError('');},[id,digest]);
 if(!review||!digest)return null;
 async function decide(approved:boolean){setBusy(true);setError('');try{await api('/agent/requests/'+id+'/approval','POST',{digest,approved,paid_consent:approved&&paid});setPaid(false);onChanged();window.dispatchEvent(new Event('pc-agent-settings'));notify(approved?bt('申请已批准，执行进度会保留在活动中心。','Request approved. Progress remains in the activity center.'):bt('已拒绝申请。','Request rejected.'));}catch(e){setError(message(e));}finally{setBusy(false);}}
 const profile=review.snapshot.profile;
 return <section className="agent-review"><h4>{bt(...(agentLabels[review.tool]||[review.tool,review.tool]))}</h4><p>{bt('图库','Catalog')} · {review.catalog_id}</p>
 {review.snapshot.photos.length>0&&<details open><summary>{bt('固定照片范围','Fixed photo scope')} · {review.snapshot.photos.length}</summary><ul>{review.snapshot.photos.map(p=><li key={p.id}>{p.name}<small> · {p.id} · SHA256 {p.hash.slice(0,12)}</small></li>)}</ul></details>}
 {profile&&<p>{profile.name} · {profile.provider} · {review.tool==='annotate_assets'?profile.vision_model:profile.image_model}</p>}
 <details><summary>{bt('查看具体参数','Review exact parameters')}</summary><pre>{JSON.stringify(review.arguments,null,2)}</pre></details>
 {status==='awaiting_approval'&&<><p>{bt('以下操作由外部Agent提出。只有此处确认后才会执行；照片、选区或模型配置变化会使申请失效。','This action was requested by an external Agent. It runs only after you approve here. Changes to photos, selection or model configuration invalidate the request.')}</p>
 {review.permission==='paid'&&<label className="check"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/>{bt('同意将以上照片的处理副本上传到所列国内模型，并承担本次请求费用。取消不保证退款，系统不会自动重试。','I agree to upload processed copies of these photos to the listed domestic model and accept this request’s charges. Cancellation does not guarantee a refund. There is no automatic retry.')}</label>}
 {error&&<p className="error-box" role="alert">{error}</p>}<div className="button-row"><button className="primary" disabled={busy||review.permission==='paid'&&!paid} onClick={()=>void decide(true)}>{bt('批准本次申请','Approve this request')}</button><button disabled={busy} onClick={()=>void decide(false)}>{bt('拒绝','Reject')}</button></div></>}
 {status==='awaiting_app'&&<p role="status">{bt('已批准。请保持软件窗口在前台，等待本机编辑器接手。','Approved. Keep the app window focused while the local editor takes over.')}</p>}
 </section>;
}
