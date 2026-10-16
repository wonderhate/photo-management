import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const [url,first,second]=process.argv.slice(2);
assert.equal(new URL(url).hostname,'127.0.0.1');
assert.equal(new URL(url).protocol,'http:');
const health=await(await fetch(url+'/api/health')).json();
assert(health.data_dir.replaceAll('\\','/').includes('/.test-artifacts/'));
assert.equal(health.version,require('./package.json').version);
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('theme','light');localStorage.setItem('onboarded','1')});
  await page.route('**/api/art/settings',r=>r.fulfill({json:{configured:true,image_model:'qwen-image-3.0',title_model:'qwen3-vl-plus'}}));
  await page.route('**/api/art/jobs',r=>r.fulfill({json:[{id:'old-openai',kind:'watercolor',status:'failed',error:'Old OpenAI request failed'}]}));
  const batches=[];
  await page.route(/\/api\/art\/(batch|generate|titles)$/,r=>{
    assert.equal(new URL(r.request().url()).pathname,'/api/art/batch');
    batches.push(r.request().postDataJSON());
    return r.fulfill({status:202,json:{id:'package-batch-'+batches.length,kind:'watercolor-batch',status:'completed',total:2,processed:2,success:2,failed:0,results:[]}});
  });
  await page.goto(url+'/watercolor');
  await expect(page.getByRole('button',{name:'批量上传照片',exact:true})).toBeVisible();
  const titles=page.getByLabel('图片生成后逐张生成并应用 AI 标题（可选）',{exact:true});
  await expect(titles).toBeVisible();
  await expect(titles).toBeDisabled();
  await expect(titles).not.toBeChecked();
  await expect(page.locator('.art-selection-hint')).toContainText('100');
  await page.screenshot({path:join(dirname(first),'packaged-watercolor-initial.png'),fullPage:true});
  await page.locator('input[type=file]').setInputFiles([first,second]);
  await expect(page.getByText('已选择 2 张照片',{exact:true})).toBeVisible();
  await expect(titles).toBeEnabled();
  await expect(titles).not.toBeChecked();
  const generate=page.getByRole('button',{name:'生成 2 张水彩海报',exact:true});
  await generate.click();
  await expect.poll(()=>batches.length).toBe(1);
  assert.equal(batches[0].generate_titles,false);
  assert.equal(new Set(batches[0].photo_ids).size,2);
  await titles.check();
  await generate.click();
  await expect.poll(()=>batches.length).toBe(2);
  assert.equal(batches[1].generate_titles,true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:join(dirname(first),'packaged-watercolor-batch.png'),fullPage:true});
  console.log('Packaged UI: visible batch entry, initial title option, multiple upload, titles off by default and explicit opt-in PASS');
} finally {await browser.close()}
