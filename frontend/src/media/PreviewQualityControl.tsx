import {bt,browserError} from '../browser/text';
import {message} from '../api';
import {getLang} from '../i18n';
import type {DisplayEdge} from '../core/display-request';
type Props={edge:0|DisplayEdge;onChange:(edge:0|DisplayEdge)=>void;disabled:boolean;pending:boolean;error?:unknown;unsupported:boolean;retry:()=>void};
export default function PreviewQualityControl({edge,onChange,disabled,pending,error,unsupported,retry}:Props){
  const text=error?(getLang()==='zh'?browserError(error):message(error)):'';
  const reason=getLang()==='zh'&&!/[\u3400-\u9fff]/u.test(text)?'本机解码未完成，请改用标准预览。':text;
  return <><label>{bt('预览清晰度','Preview quality')}<select aria-label={bt('预览清晰度','Preview quality')} value={edge} disabled={disabled}
    title={bt('高清预览按需读取原片，在本机处理，不更改编辑参数。','High-resolution previews read the source on demand and process locally without changing edits.')}
    onChange={e=>onChange(Number(e.target.value) as 0|DisplayEdge)}>
    <option value={0}>{bt('标准预览','Standard preview')}</option><option value={4096}>{bt('高清 · 最长边 4096','High · Up to 4096')}</option><option value={6144}>{bt('细节 · 最长边 6144','Detail · Up to 6144')}</option>
  </select></label>
    {pending&&<small className="display-preview-status" role="status">{bt('正在生成高清预览…','Preparing high-resolution preview…')}</small>}
    {error&&<small className="display-preview-status error-box" role="status">{bt('高清预览未加载，仍显示标准预览。','High-resolution preview unavailable; showing the standard preview.')} {reason} <button onClick={retry}>{bt('重试本地预览','Retry local preview')}</button></small>}
    {unsupported&&<small className="display-preview-status" role="status">{bt('缺少源文件校验信息，请重新打开照片。','Source verification data is missing. Reopen the photo.')}</small>}
  </>;
}
