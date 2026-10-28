import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interruptTasks} from '../src/core/task-recovery.ts';
import type {Job} from '../src/types.ts';
test('recovery keeps complete stages and result references without resubmission',()=>{
  const records=[{id:'root',kind:'watercolor',status:'running',billing_state:'submitted',results:[{path:'exports/saved.png',file_name:'saved.png',url:''}]},
    {id:'done',kind:'watercolor-image',status:'completed',parent_id:'root',billing_state:'responded'},
    {id:'working',kind:'watercolor-titles',status:'running',parent_id:'root',billable:true,billing_state:'submitted'},
    {id:'queued',kind:'watercolor',status:'queued',billing_state:'not_submitted'},
    {id:'local',kind:'import',status:'running'}] as Job[];
  interruptTasks(records);assert.equal(records[0].status,'interrupted');assert.equal(records[0].billing_uncertain,true);
  assert.equal(records[1].status,'completed');assert.equal(records[2].billing_state,'unknown');assert.equal(records[3].billing_state,'not_submitted');assert.doesNotMatch(records[3].error!,/billed/);
  assert.equal(records[0].results[0].path,'exports/saved.png');assert.match(records[4].error!,/Completed files are kept/);
});
