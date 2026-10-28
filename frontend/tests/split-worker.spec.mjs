import {test,expect} from './fixtures/native-runtime.mjs';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {exerciseSplitWorker} from './fixtures/split-worker.mjs';
const assets=fileURLToPath(new URL('../dist/assets/',import.meta.url));
const module='/assets/'+readdirSync(assets).find(f=>/^editor-adapter-.*\.js$/.test(f));

test('native real split worker encodes seamless pixels and atomically persists the complete group',async({page,request})=>{
  test.setTimeout(90000);const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang','en')});await page.goto('/tools/darkroom');await expect(page.locator('.editor-toolbar')).toBeVisible();
  const result=await exerciseSplitWorker(page,module,true);const detail=await(await request.get('/api/editor/splits/'+result.saved.id)).json();expect(detail.source_hash).toBe(result.before);
  expect(detail.panels.map(p=>p.split.index)).toEqual([0,1,2]);expect(detail.master.kind).toBe('split-master');expect(detail.panels.every(p=>p.split.group_id===result.saved.id)).toBe(true);
});
