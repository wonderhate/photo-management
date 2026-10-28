import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeTask,taskActive,taskKind,taskStatus} from '../src/workspace/task-summary.ts';

test('task summaries retain progress and parent metadata without results or private payloads',()=>{
  const input={id:'fixture',kind:'watercolor',status:'running',total:2,processed:1,success:1,skipped:0,failed:0,current:'',errors:['synthetic'],results:[{file_name:'synthetic.png',url:'blob:synthetic'}],parent_id:'parent',cancelled:true,child_count:2,billing_state:'unknown',billing_uncertain:true,private_field:'not-in-summary'};
  const summary=summarizeTask(input);assert.equal(summary.result_count,1);assert.equal(summary.error_count,1);assert.equal(summary.parent_id,'parent');assert.equal(summary.cancelled,true);
  assert.equal(summary.child_count,2);assert.equal(summary.billing_state,'unknown');assert.equal(summary.billing_uncertain,true);
  for(const key of ['results','errors','private_field'])assert.equal(key in summary,false);
  assert.equal(taskActive(summary),true);assert.equal(taskActive({...summary,status:'interrupted'}),false);assert.equal(taskActive({...summary,status:'unknown'}),false);
  assert.equal(taskKind('watercolor'),'水彩转绘');assert.equal(taskStatus('interrupted'),'已中断');
});
