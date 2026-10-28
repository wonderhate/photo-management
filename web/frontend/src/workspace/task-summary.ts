import type {Job} from '../types';

export interface TaskSummary extends Pick<Job,'id'|'kind'|'status'|'total'|'processed'|'success'|'skipped'|'failed'|'current'> {
  phase?:string;stage?:string;cancelled?:boolean;parent_id?:string;resource?:string;billable?:boolean;
  child_count?:number;active_child_id?:string|null;billing_state?:string;billing_uncertain?:boolean;request_id?:string;provider?:string;model?:string;
  updated_at?:string;error_count?:number;result_count?:number;
  preview_total?:number;preview_processed?:number;preview_failed?:number;
}
const FIELDS=['id','kind','status','total','processed','success','skipped','failed','current','phase','stage','cancelled','parent_id','resource','billable','billing_state','billing_uncertain','request_id','provider','model','child_count','active_child_id','updated_at','preview_total','preview_processed','preview_failed'] as const;
export function summarizeTask(job:Job&Record<string,unknown>):TaskSummary{
  return {...Object.fromEntries(FIELDS.filter(key=>job[key]!==undefined).map(key=>[key,job[key]])),error_count:job.errors?.length||0,result_count:job.results?.length||0} as unknown as TaskSummary;
}
export const taskActive=(task:TaskSummary)=>['queued','running','submitted','awaiting_approval','awaiting_app','paused'].includes(task.status);
export function taskProgress(task:{phase?:string;processed:number;total:number;preview_processed?:number;preview_total?:number}){return {processed:task.phase==='previews'?task.preview_processed||0:task.processed,total:task.phase==='previews'?task.preview_total||0:task.total,indeterminate:task.phase==='scanning'};}
const KINDS:Record<string,string>={'vision-depth':'本地深度估计','vision-segment':'本地主体抠图','ai-annotation':'AI照片标注','ai-restyle':'AI风格重绘','ai-handwriting':'AI手写字','raw-source-index':'RAW 来源登记','appearance-index':'外观索引','appearance-photos':'照片外观分析','video-import':'视频导入','video-proxy':'视频兼容转码','text-index':'文字索引',import:'照片导入',export:'水印导出',watercolor:'水彩转绘','watercolor-title':'建议标题','watercolor-batch':'批量水彩',faces:'人物分析','faces-import':'导入后人物分析','face-models':'人物模型下载','import-scan':'扫描文件','import-preview':'生成照片预览','import-index':'校验与入库','export-render':'渲染与导出','watercolor-image':'生成水彩','watercolor-images':'批量生成阶段','watercolor-titles':'标题阶段','faces-analyze':'人物分析阶段','face-model-download':'人脸模型下载阶段','semantic-prepare':'语义模型与索引','semantic-model':'准备语义模型','semantic-index':'语义索引更新','semantic-photos':'照片语义分析'};
const STATUSES:Record<string,string>={queued:'等待中',running:'处理中',submitted:'已提交',unknown:'结果待确认',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
export function taskKind(kind:string):string{return kind==='agent-request'?'Agent请求':kind==='agent-previews'?'Agent预览生成':KINDS[kind]||kind;}
export function taskStatus(status:string):string{return ({awaiting_approval:'等待应用内确认',awaiting_app:'等待本机编辑器',paused:'已暂停'} as Record<string,string>)[status]||STATUSES[status]||status;}
export function taskResource(resource:string):string{return ({io:'读取与入库',render:'图像渲染','local-ai':'本地推理',cloud:'云端请求',network:'模型下载'} as Record<string,string>)[resource]||resource;}
