import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic,photos} from './fixtures/workspace.mjs';
import {readFileSync} from 'node:fs';
const styles=JSON.parse(readFileSync(new URL('../src/core/ai-styles.json',import.meta.url),'utf8'));
for(const [lang,width] of [['zh',1440],['en',390]])test(`AI studio explicit scope and human place review ${lang} ${width}`,async({page},info)=>{
  const {errors}=await synthetic(page,{lang,width,theme:lang==='en'?'light':'dark',reducedMotion:'reduce'});let calls=0,reviews=0;
  const profile={id:'fixture-profile',name:'Synthetic domestic account',provider:'qwen-cn',region:'cn-beijing',workspace:'',image_model:'qwen-image-3.0',vision_model:'qwen3-vl-plus',revision:1,configured:true,endpoint:'https://dashscope.aliyuncs.com/',key_source:'session',capabilities:{image:true,annotation:true,size:'model-default'}};
  const result={id:'fixture-result',kind:'annotation',photo_id:photos[0].id,created_at:'2026-10-27',revision:1,provider:'qwen-cn',model:'qwen3-vl-plus',request_id:'synthetic-request',source:{id:photos[0].id,name:photos[0].file_name,hash:'a'.repeat(64)},result:{version:1,caption_zh:'合成山景',caption_en:'Synthetic mountains',tags:[{zh:'山',en:'Mountain'}],detected_text:'TEST',place_guess:{name:'Unverified lake',confidence:.2,evidence:'Shape only'}},applied:true};
  await page.route('**/api/ai/**',async route=>{const r=route.request(),path=new URL(r.url()).pathname.slice(7);
    if(path==='/status')return route.fallback();
    if(path==='/profiles')return route.fulfill({json:[profile]});if(path==='/styles')return route.fulfill({json:styles});
    if(path==='/results')return route.fulfill({json:{items:calls?[result]:[],total:calls?1:0}});
    if(path==='/annotation-scope'){const b=r.postDataJSON();expect(b.photo_ids).toEqual([photos[0].id]);return route.fulfill({json:{token:'synthetic-token',count:1,photos:[{id:photos[0].id,name:photos[0].file_name}],profile,options:b.options}});}
    if(path==='/annotate'){expect(r.postDataJSON()).toEqual({token:'synthetic-token',count:1,confirmed:true});calls++;return route.fulfill({status:202,json:{id:'fixture-job',kind:'ai-annotation',status:'completed',total:1,processed:1,success:1,failed:0,skipped:0,current:'',errors:[],results:[{result_id:result.id,status:'completed',billing_state:'responded'}]}});}
    if(path==='/results/'+result.id)return route.fulfill({json:result});
    if(path==='/results/'+result.id+'/place-review'){expect(r.postDataJSON().status).toBe('accepted');reviews++;result.place_review={status:'accepted',reviewed_at:'2026-10-27'};result.revision++;return route.fulfill({json:result});}
    throw new Error('Unexpected synthetic AI route '+path);
  });
  await page.goto('/?page=ai-studio');await expect(page.locator('.ai-studio h1')).toBeVisible();expect(calls).toBe(0);
  await page.locator('.ai-photo-picker input').first().check();await page.getByRole('button',{name:lang==='zh'?'检查范围与数量':'Review scope and count',exact:true}).click();
  await expect(page.locator('.ai-scope-list')).toContainText(photos[0].file_name);
  const start=page.getByRole('button',{name:lang==='zh'?'开始已确认的任务':'Start confirmed task',exact:true});await expect(start).toBeDisabled();expect(calls).toBe(0);
  await page.getByLabel(lang==='zh'?/确认将所选照片/:/I confirm sending selected photos/).check();await start.click();expect(calls).toBe(1);
  await page.getByRole('button',{name:lang==='zh'?'查看结果':'View result',exact:true}).click();await expect(page.getByText('Unverified lake',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:lang==='zh'?'我已核对地点，确认此猜测':'I checked the location; accept this guess',exact:true}).click();await expect.poll(()=>reviews).toBe(1);expect(calls).toBe(1);
  await expect(page.getByText(lang==='zh'?'已人工确认（未写入GPS）':'Confirmed by you (GPS unchanged)',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('ai-studio-review.png'),fullPage:true});expect(errors).toEqual([]);
});
