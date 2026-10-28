import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitExportNames,splitExportStem} from '../src/core/split-export.ts';
test('split output paths remain single safe basenames and number complete groups',()=>{
  assert.equal(splitExportStem('山海之间_split-master.png'),'山海之间');assert.equal(splitExportStem('山海之间-master.png'),'山海之间');
  assert.equal(splitExportStem('CON-master.png'),'photo_CON');assert.equal(splitExportStem('../a\\b-master.png'),'_a_b');
  const flat=splitExportNames('海','png',3,false,2);assert.deepEqual(flat,{folder:'',files:['海_split_2_01.png','海_split_2_02.png','海_split_2_03.png']});
  const nested=splitExportNames('海','jpg',2,true,1);assert.deepEqual(nested,{folder:'海_split_1',files:['海_split_01.jpg','海_split_02.jpg']});
  for(const [stem,format,count,attempt] of [['../a','png',2,0],['x','gif',2,0],['x','png',1,0],['x','png',11,0],['x','png',2,-1]])assert.throws(()=>splitExportNames(stem as string,format as never,count as number,true,attempt as number));
});
