import type {Job} from '../types';
export function interruptTasks(jobs:Job[]){
  for(const job of jobs){
    if(!['queued','running','submitted'].includes(job.status))continue;
    const cloud=job.billable||job.kind.startsWith('watercolor');
    job.status='interrupted';job.current='';job.active_child_id=null;
    job.error=cloud?(job.billing_state==='not_submitted'?'The page closed before the cloud request was submitted. No automatic retry.':job.billing_state==='responded'?'The page closed before the result was saved. No automatic retry.':'The page closed before the result was saved. The request may have been billed. No automatic retry.'):'The page closed before the task finished. Completed files are kept. No automatic retry.';
    if(cloud&&!['responded','not_submitted'].includes(job.billing_state||'')){job.billing_state='unknown';job.billing_uncertain=true;}
  }
  const byId=new Map(jobs.map(j=>[j.id,j]));for(const job of jobs)if(job.billing_uncertain&&job.parent_id){const parent=byId.get(job.parent_id);if(parent)parent.billing_uncertain=true;}
}
