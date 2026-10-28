import {collageDocumentSources} from '../core/collage-project';
import type {CollageProject} from '../core/collage-project';
import {bt} from '../browser/text';
export default function CollageSourceDetails({record}:{record:CollageProject}){
 const sources=collageDocumentSources(record.document),book=record.document.kind==='batch'?record.document.value:null;
 return <section className="collage-source-details" aria-label={bt('工程来源信息','Project source information')}><p className="muted">{bt('来源信息为保存时的记录；打开工程时核验快照。照片记录移除后仍可恢复。','Source information reflects the saved project; snapshots are checked when opening. Removing a library photo does not prevent recovery.')}</p><ol>{sources.map(s=><li key={s.id}><strong>{s.name}</strong><span>{s.width} × {s.height} · {s.bits}-bit · {bt('解码版本 ','Decode version ')}{s.profile.version}</span><span>{record.photo_links.some(l=>l.source_id===s.id)?bt('已记录图库来源','Library source recorded'):bt('本地文件快照','Local file snapshot')}{book?.omitted.includes(s.id)?bt(' · 当前跳过',' · Currently skipped'):book?bt(' · 页面 ',' · Pages ')+book.pages.flatMap((p,i)=>p.cells.some(c=>c.source_id===s.id)?[i+1]:[]).join(', '):''}</span><small>SHA-256 {s.sha256}</small></li>)}</ol></section>;
}
