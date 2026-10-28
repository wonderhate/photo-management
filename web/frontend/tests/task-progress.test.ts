import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskProgress,summarizeTask} from '../src/workspace/task-summary.ts';
import type {Job} from '../src/types.ts';
test('preview progress remains separate from the fixed admitted-file counts',()=>{
  const job={id:'import',kind:'import',status:'running',phase:'previews',total:103,processed:100,success:100,skipped:0,failed:0,current:'',errors:[],results:[],preview_total:100,preview_processed:32,preview_failed:1} as Job;
  const summary=summarizeTask(job as Job&Record<string,unknown>);
  assert.equal(summary.processed,100);assert.equal(summary.total,103);assert.deepEqual(taskProgress(summary),{processed:32,total:100,indeterminate:false});
  assert.equal(summary.preview_failed,1);assert.equal(summary.result_count,0);
  assert.equal(taskProgress({...summary,phase:'scanning'}).indeterminate,true);
  assert.deepEqual(taskProgress({...summary,phase:'processing'}),{processed:100,total:103,indeterminate:false});
});
