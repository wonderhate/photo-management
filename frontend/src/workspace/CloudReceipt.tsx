import {bt} from '../browser/text';

type Receipt={id?:string;provider?:string;model?:string;request_id?:string;title_request_id?:string;billing_state?:string;billing_uncertain?:boolean};
export default function CloudReceipt({value}:{value:Receipt}){
  return <div className="cloud-receipt" style={{overflowWrap:'anywhere'}}>
    {value.id&&<small>{bt('本地任务编号','Local task ID')}: {value.id}</small>}
    {(value.provider||value.model)&&<p>{value.provider} · {value.model}</p>}
    {value.request_id&&<p>{bt('服务请求编号','Provider request ID')}: <code>{value.request_id}</code></p>}
    {value.title_request_id&&<p>{bt('标题请求编号','Title request ID')}: <code>{value.title_request_id}</code></p>}
    {(value.billing_uncertain||value.billing_state==='unknown')&&!value.request_id&&<p>{bt('服务尚未返回请求编号。请按账户、模型和提交时间核对服务记录；本地任务编号不是服务请求编号。','No provider request ID was returned. Check provider records by account, model and submission time; the local task ID is not a provider request ID.')}</p>}
  </div>;
}
