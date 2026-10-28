import {navigateWorkspace} from './fixtures/workspace-navigation.mjs';
import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic,photos} from './fixtures/workspace.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

test('hover inspector waits, stays open and follows without changing selection',async({page})=>{
  const {errors}=await synthetic(page);await page.goto('/?page=photos');
  const cards=page.locator('.photo-card'),drawer=page.getByRole('complementary',{name:'悬停照片信息'});
  await cards.first().hover();await page.waitForTimeout(700);await expect(drawer).toHaveCount(0);
  await page.waitForTimeout(450);await expect(drawer).toBeVisible();await expect(drawer.locator('.inspector-file-name')).toHaveText(photos[0].file_name);
  await page.locator('.topbar .archive-wordmark').hover();await page.waitForTimeout(200);await expect(drawer).toBeVisible();
  await cards.nth(1).hover();await expect(drawer.locator('.inspector-file-name')).toHaveText(photos[1].file_name);
  await expect(page.locator('.photo-card.selected')).toHaveCount(0);
  await drawer.getByRole('button',{name:'关闭照片信息',exact:true}).click();await page.waitForTimeout(1100);await expect(drawer).toHaveCount(0);
  await cards.first().hover();await page.waitForTimeout(450);await page.locator('.topbar .archive-wordmark').hover();await page.waitForTimeout(700);await expect(drawer).toHaveCount(0);
  await cards.first().locator('.photo-image').click();await expect(cards.first()).toHaveClass(/selected/);await expect(page.locator('.photo-viewer')).toHaveCount(0);
  await cards.first().locator('.photo-image').dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();
  await expect(page.getByLabel('展映模式',{exact:true}).locator('option')).toHaveText(['普通浏览','极光','雪境','胶片列车']);
  await page.keyboard.press('Escape');await expect(cards.first()).toHaveClass(/selected/);
  await cards.first().locator('.select-box').click();await expect(page.locator('.photo-card.selected')).toHaveCount(0);
  await cards.first().locator('.photo-image').dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.photo-card.selected')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keyboard can open and close the information drawer with focus restored',async({page})=>{
  const {errors}=await synthetic(page);await page.goto('/?page=photos');await expect(page.locator('.photo-card').first()).toBeVisible();
  const opener=page.getByRole('button',{name:'显示照片信息',exact:true});await expect(opener).toBeEnabled();
  await opener.focus();await page.keyboard.press('Enter');
  const close=page.getByRole('button',{name:'关闭照片信息',exact:true});await expect(close).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.locator('.photo-inspector')).toHaveCount(0);await expect(opener).toBeFocused();expect(errors).toEqual([]);
});

test('inspector recovers from pointer movement without an enter event and keeps the original dwell deadline',async({page})=>{
  await synthetic(page);await page.goto('/?page=photos');const cards=page.locator('.photo-card'),drawer=page.locator('.photo-inspector');await expect(cards.first()).toBeVisible();await page.locator('.topbar .archive-wordmark').hover();
  // Layout replacement can retain the same hit-test target, producing a move
  // without a fresh enter. Repeated moves inside that photo must not reset 1s.
  await cards.first().dispatchEvent('pointermove',{pointerType:'mouse'});await page.waitForTimeout(650);await expect(drawer).toHaveCount(0);
  await cards.first().dispatchEvent('pointermove',{pointerType:'mouse'});await page.waitForTimeout(450);await expect(drawer).toBeVisible();
  await cards.nth(1).dispatchEvent('pointermove',{pointerType:'mouse'});await expect(drawer.locator('.inspector-file-name')).toHaveText(photos[1].file_name);
  await drawer.getByRole('button',{name:'关闭照片信息',exact:true}).click();await cards.first().dispatchEvent('pointermove',{pointerType:'touch'});await page.waitForTimeout(1100);await expect(drawer).toHaveCount(0);
});

test('narrow information drawer stays below both navigation rows and can close',async({page},info)=>{
  const {errors}=await synthetic(page,{width:390,theme:'light',lang:'en'});await page.goto('/?page=photos');
  await page.locator('.photo-card').first().hover();const drawer=page.locator('.photo-inspector');await expect(drawer).toBeVisible();
  const nav=await page.locator('.workspace-subnav').boundingBox(),panel=await drawer.boundingBox();expect(panel.y).toBeGreaterThanOrEqual(nav.y+nav.height);
  await page.screenshot({path:info.outputPath('inspector-narrow.png')});
  await drawer.getByRole('button',{name:'Close photo information',exact:true}).click();await expect(drawer).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rapid page switches finish at the last page and cancel motion when requested',async({page})=>{
  await synthetic(page);await page.goto('/?page=home');
  const nav=page.locator('.workspace-subnav');
  await nav.getByRole('button',{name:'影集',exact:true}).click();
  await nav.getByRole('button',{name:'照片',exact:true}).click();
  await expect(page).toHaveURL(/page=photos/);await expect(page.locator('.gallery-heading')).toBeVisible();
  await expect(page.locator('.workspace-transition')).toHaveAttribute('data-motion','idle');
  await page.evaluate(()=>document.querySelector('.photography-space-link').click());
  await expect(page.locator('.workspace-transition')).toHaveAttribute('data-motion','running');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('.workspace-transition')).toHaveAttribute('data-motion','idle');
});

test('closed inspector ignores a delayed response from an older hovered photo',async({page})=>{
  await synthetic(page);let release;
  await page.route('**/api/photos/frame-0',async route=>{await new Promise(resolve=>{release=resolve});await route.fulfill({json:photos[0]}).catch(()=>{});});
  await page.goto('/?page=photos');await page.locator('.photo-card').first().hover();
  const drawer=page.locator('.photo-inspector');await expect(drawer).toBeVisible();
  await page.locator('.photo-card').nth(1).hover();await expect(drawer.locator('.inspector-file-name')).toHaveText(photos[1].file_name);
  release?.();await page.waitForTimeout(150);await expect(drawer.locator('.inspector-file-name')).toHaveText(photos[1].file_name);
  await drawer.getByRole('button',{name:'关闭照片信息'}).click();await expect(drawer).toHaveCount(0);
  await page.locator('.photo-card').first().hover();await page.waitForTimeout(300);await navigateWorkspace(page,'统计');
  await page.waitForTimeout(1100);await expect(drawer).toHaveCount(0);
});

for(const [theme,width,lang] of [['dark',1440,'zh'],['light',390,'en'],['light',900,'en']])test(`labeled navigation, startup and home return ${theme} ${width}`,async({page},info)=>{
  const {errors}=await synthetic(page,{theme,width,lang});await page.goto('/');
  await expect(page.locator('.archive-hero')).toBeVisible();
  const nav=page.locator('.workspace-subnav'),label=lang==='en'?'Photos':'照片',button=nav.getByRole('button',{name:label,exact:true});
  await expect(nav).toBeVisible();await expect(button).toHaveText(label);
  const more=nav.locator('.workspace-more-trigger');await more.click();await expect(more).toHaveAttribute('aria-expanded','true');await expect(nav.getByRole('button',{name:lang==='en'?'Settings':'设置',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(more).toHaveAttribute('aria-expanded','false');await expect(more).toBeFocused();
  await more.click();await page.locator('.archive-wordmark').click();await expect(more).toHaveAttribute('aria-expanded','false');
  await button.click();await expect(page.locator('.gallery-heading')).toBeVisible();await page.waitForTimeout(600);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const palette=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return ['--bg','--panel','--accent'].map(k=>s.getPropertyValue(k).trim());});
  expect(palette).toEqual(theme==='dark'?['#080808','#141414','#c9a558']:['#f7f5f0','#fffefa','#826225']);
  await page.screenshot({path:info.outputPath('workspace.png'),fullPage:true});
  await page.locator('.photography-space-link').click();await expect(page.locator('.archive-hero')).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});await button.click();await expect(page.locator('.workspace-transition')).toHaveAttribute('data-motion','idle');
  expect(errors).toEqual([]);
});

for(const width of [1440,390])test(`four gallery layouts keep selection, order, viewer and preferences ${width}`,async({page},info)=>{
  const {errors}=await synthetic(page,{width,theme:'light',lang:'en'});await page.goto('/?page=photos');
  await page.getByRole('button',{name:'Select FRAME_00.jpg',exact:true}).click();
  await page.getByRole('button',{name:'Grid Display Settings',exact:true}).click();
  const layout=page.getByLabel('Gallery layout',{exact:true});
  for(const mode of ['grid','tiles','waterfall','justified']){
    await layout.selectOption(mode);await expect(page.locator('.photo-card.selected')).toHaveCount(1);
    await expect(page.getByRole('button',{name:'Select FRAME_00.jpg',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(await page.locator('.photo-image').evaluateAll(buttons=>buttons.map(b=>b.getAttribute('aria-label')))).toEqual(photos.map(p=>'View '+p.file_name).slice(0,await page.locator('.photo-image').count()));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(mode==='waterfall')await page.screenshot({path:info.outputPath('waterfall.png'),fullPage:true});
  }
  await layout.selectOption('tiles');await page.getByRole('button',{name:'Grid Display Settings',exact:true}).click();
  await page.getByRole('button',{name:'View FRAME_00.jpg',exact:true}).dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('.photo-card.selected')).toHaveCount(1);
  await page.reload();await expect(page.locator('.tile-gallery')).toBeVisible();expect(errors).toEqual([]);
});

test('50,000-photo waterfall scroll keeps rendered cards and loaded records bounded and selects the actual viewport',async({page})=>{
  const {errors}=await synthetic(page);const ids=Array.from({length:50000},(_,i)=>'frame-'+i),requests=[];
  await page.route('**/api/photos/ids?*',route=>route.fulfill({json:{ids}}));
  await page.route('**/api/photos/by-ids',route=>{
    const asked=route.request().postDataJSON().ids;requests.push(asked.length);
    return route.fulfill({json:{photos:asked.map(id=>({...photos[0],id,file_name:id+'.jpg'}))}});
  });
  await page.goto('/?page=photos');await page.getByRole('button',{name:'网格显示设置',exact:true}).click();await page.getByLabel('浏览布局',{exact:true}).selectOption('waterfall');await page.getByRole('button',{name:'网格显示设置',exact:true}).click();
  const scroller=page.locator('.waterfall-scroller');await expect(scroller).toBeVisible();
  for(const fraction of Array.from({length:19},(_,i)=>(i+1)/20)){
    const before=await page.locator('.photo-image').evaluateAll(buttons=>buttons[0]?.getAttribute('aria-label'));
    await scroller.evaluate((node,fraction)=>{node.scrollTop=node.scrollHeight*fraction},fraction);
    await expect.poll(()=>page.locator('.photo-image').evaluateAll((buttons,before)=>buttons[0]?.getAttribute('aria-label')||before,before)).not.toBe(before);
    await expect.poll(()=>page.locator('.waterfall-cell .vg-placeholder').count()).toBe(0);
    expect(await page.locator('.photo-card').count()).toBeLessThan(160);
    const count=Number((await page.locator('.vg-total').innerText()).match(/已加载 (\d+)/)?.[1]);expect(count).toBeLessThanOrEqual(600);
  }
  const visible=await scroller.evaluate(node=>{const bounds=node.getBoundingClientRect();return [...node.querySelectorAll('.waterfall-cell')].filter(el=>{const rect=el.getBoundingClientRect();return rect.bottom>=bounds.top&&rect.top<=bounds.bottom;}).map(el=>el.querySelector('.photo-image').getAttribute('aria-label').replace('查看 ',''));});
  await page.getByRole('button',{name:'选择可见',exact:true}).click();
  expect(await page.locator('.photo-card.selected .photo-image').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label').replace('查看 ','')))).toEqual(visible);
  expect(requests.reduce((sum,count)=>sum+count,0)).toBeGreaterThan(600);
  expect(requests.every(count=>count<=190)).toBe(true);expect(errors).toEqual([]);
});

test('shortcut recording, scope conflicts and modal keys cannot trigger a selected photo action',async({page,request})=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,'shortcut-synthetic.jpg');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; Image.new('RGB',(80,60),'#367b89').save(sys.argv[1])",source]);
  const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=digest();
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1');});
  let confirmations=0;page.on('dialog',async dialog=>{confirmations++;await dialog.dismiss();});
  await page.goto('/?page=photos');await page.locator('.select-box').first().click();
  await navigateWorkspace(page,'设置');
  const previous=page.getByLabel('详情 · 上一张',{exact:true});await previous.focus();await previous.press('f');
  await expect(page.getByText('快捷键已用于：收藏 / 取消收藏',{exact:true})).toBeVisible();
  await previous.press('q');await expect(previous).toHaveValue('Q');await previous.press('Escape');await expect(previous).toHaveValue('Q');
  await previous.press('Tab');await expect(page.getByLabel('详情 · 下一张',{exact:true})).toBeFocused();
  await page.locator('.photography-space-link').focus();await page.keyboard.press('Delete');expect(confirmations).toBe(0);
  await navigateWorkspace(page,'照片');
  await page.keyboard.press('?');await expect(page.getByRole('dialog',{name:'键盘快捷键',exact:true})).toBeVisible();
  await page.keyboard.press('Delete');expect(confirmations).toBe(0);await page.keyboard.press('Escape');
  await page.locator('.photography-space-link').focus();await page.keyboard.press('Delete');expect(confirmations).toBe(1);expect(digest()).toBe(before);
});

test('activity center shows concurrent import, export and AI work and cancels only the selected job',async({page})=>{
  const {errors}=await synthetic(page);const cancelled=[];
  const base={total:2,processed:1,success:1,failed:0,skipped:0,current:'',errors:[],results:[]};
  const jobs=[{...base,id:'activity-import',kind:'import',status:'running'},{...base,id:'activity-export',kind:'export',status:'queued'},{...base,id:'activity-ai',kind:'watercolor',status:'interrupted'}];
  await page.route('**/api/jobs**',async route=>{
    const url=new URL(route.request().url()),parts=url.pathname.split('/').filter(Boolean);
    if(parts.length===2)return route.fulfill({json:jobs});
    const job=jobs.find(job=>job.id===parts[2]);
    if(parts[3]==='cancel'){cancelled.push(job.id);job.status='cancelled';}
    if(job.id==='activity-import')await new Promise(resolve=>setTimeout(resolve,250));
    return route.fulfill({json:job}).catch(()=>{});
  });
  await page.goto('/?page=photos');await page.getByRole('button',{name:'活动中心',exact:true}).click();
  const center=page.getByRole('dialog',{name:'活动中心',exact:true}),list=center.locator('.activity-list');
  await expect(list.locator('button')).toHaveCount(3);await list.getByRole('button',{name:/照片导入/}).click();await list.getByRole('button',{name:/水印导出/}).click();
  await expect(center.locator('.activity-detail h3')).toContainText('水印导出');await page.waitForTimeout(350);await expect(center.locator('.activity-detail h3')).toContainText('水印导出');
  await list.getByRole('button',{name:/水印导出/}).click();await expect(center.locator('.activity-detail h3')).toContainText('水印导出');
  await center.getByRole('button',{name:'取消任务',exact:true}).click();await expect(center.locator('.activity-detail h3')).toContainText('已取消');expect(cancelled).toEqual(['activity-export']);
  await list.getByRole('button',{name:/水彩转绘/}).click();await expect(center.locator('.activity-detail h3')).toContainText('已中断');
  await expect(center.getByRole('button',{name:/重试|重新/})).toHaveCount(0);await center.getByRole('button',{name:'关闭',exact:true}).click();expect(errors).toEqual([]);
});

test('English activity center fits a narrow window',async({page},info)=>{
  const {errors}=await synthetic(page,{width:390,lang:'en',theme:'light'});
  const task={id:'activity-done',kind:'import',status:'completed',total:1,processed:1,success:1,failed:0,skipped:0,current:'',errors:[],results:[]};
  await page.route('**/api/jobs**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/activity-done')?task:[task]}));
  await page.goto('/?page=photos');await page.getByRole('button',{name:'Activity center',exact:true}).click();
  const center=page.getByRole('dialog',{name:'Activity center',exact:true});await center.locator('.activity-list button').first().click();
  await expect(center.locator('.activity-detail h3')).toContainText('Done');expect(await center.innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('activity-narrow.png')});expect(errors).toEqual([]);
});

for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`semantic indexing stages stay visible and cancel their required workflow ${width} ${lang}`,async({page},info)=>{
  const {errors}=await synthetic(page,{width,lang,theme:lang==='en'?'light':'dark'}),cancelled=[],unexpected=[];
  const root={id:'semantic-root',kind:'semantic-index',status:'running',total:3,processed:1,success:1,failed:0,skipped:0,current:'',errors:[],results:[],resource:'local-ai',child_count:1,active_child_id:'semantic-stage'};
  const child={...root,id:'semantic-stage',kind:'semantic-photos',parent_id:root.id,child_count:0,active_child_id:null};
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(?:ai\/load|faces\/analyze)/.test(request.url()))unexpected.push(request.url());});
  await page.route('**/api/jobs**',route=>{
    const parts=new URL(route.request().url()).pathname.split('/').filter(Boolean);
    if(parts.length===2)return route.fulfill({json:[root]});
    if(parts[3]==='children')return route.fulfill({json:{items:[child],total:1}});
    if(parts[3]==='cancel'){cancelled.push(parts[2]);root.status=child.status='cancelled';root.active_child_id=null;}
    return route.fulfill({json:parts[2]===child.id?child:root});
  });
  await page.goto('/?page=photos');await page.getByRole('button',{name:lang==='en'?'Activity center':'活动中心',exact:true}).click();const center=page.getByRole('dialog',{name:lang==='en'?'Activity center':'活动中心',exact:true});
  await center.locator('.activity-list button').first().click();await expect(center.locator('.activity-detail h3')).toContainText(lang==='en'?'Semantic index update':'语义索引更新');
  await center.locator('.activity-stages button').click();await expect(center.locator('.activity-detail h3')).toContainText(lang==='en'?'Photo semantic analysis':'照片语义分析');
  await expect(center.getByText(lang==='en'?'Cancelling a required stage also stops later stages of the overall task.':'取消必要阶段也会停止整体任务的后续阶段。',{exact:true})).toBeVisible();
  if(lang==='en')expect(await center.innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await page.screenshot({path:info.outputPath('semantic-stage.png')});
  await center.getByRole('button',{name:lang==='en'?'Cancel Task':'取消任务',exact:true}).click();await expect(center.locator('.activity-detail h3')).toContainText(lang==='en'?'Cancelled':'已取消');
  await center.getByRole('button',{name:lang==='en'?'Back to overall task':'返回整体任务',exact:true}).click();await expect(center.locator('.activity-detail h3')).toContainText(lang==='en'?'Cancelled':'已取消');
  expect(cancelled).toEqual([child.id]);expect(unexpected).toEqual([]);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a delayed cancellation cannot replace the task selected afterwards',async({page})=>{
  await synthetic(page);let release;
  const base={kind:'export',status:'running',total:1,processed:0,success:0,failed:0,skipped:0,current:'',errors:[],results:[]};
  const tasks=[{...base,id:'cancel-first'},{...base,id:'inspect-next',kind:'watercolor',status:'interrupted'}];
  await page.route('**/api/jobs**',async route=>{
    const url=new URL(route.request().url()),id=url.pathname.split('/')[3];
    if(!id)return route.fulfill({json:tasks});
    const task=tasks.find(task=>task.id===id);
    if(url.pathname.endsWith('/cancel')){await new Promise(resolve=>{release=resolve});task.status='cancelled';}
    return route.fulfill({json:task}).catch(()=>{});
  });
  await page.goto('/?page=photos');await page.getByRole('button',{name:'活动中心',exact:true}).click();
  const center=page.getByRole('dialog',{name:'活动中心',exact:true});await center.locator('.activity-list button').first().click();
  await expect(center.locator('.activity-detail h3')).toContainText('水印导出');await center.getByRole('button',{name:'取消任务',exact:true}).click();
  await expect.poll(()=>!!release).toBe(true);await center.locator('.activity-list button').nth(1).click();await expect(center.locator('.activity-detail h3')).toContainText('水彩转绘');
  release();await page.waitForTimeout(200);await expect(center.locator('.activity-detail h3')).toContainText('水彩转绘');
});

test('closing a pending viewer and rapid photo navigation ignore older responses',async({page})=>{
  const {errors}=await synthetic(page);let release;
  await page.route('**/api/photos/frame-0',async route=>{await new Promise(resolve=>{release=resolve});await route.fulfill({json:photos[0]}).catch(()=>{});});
  await page.goto('/?page=photos');await page.locator('.photo-image').first().dblclick();await expect.poll(()=>!!release).toBe(true);
  await page.keyboard.press('Escape');release();await page.waitForTimeout(150);await expect(page.locator('.photo-viewer')).toHaveCount(0);
  await page.unroute('**/api/photos/frame-0');await page.locator('.photo-image').first().dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();
  let slow;
  await page.route('**/api/photos/frame-1',async route=>{await new Promise(resolve=>{slow=resolve});await route.fulfill({json:photos[1]}).catch(()=>{});});
  await page.getByRole('button',{name:'下一张',exact:true}).click();await expect.poll(()=>!!slow).toBe(true);
  await page.getByRole('button',{name:'下一张',exact:true}).click();await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_02.jpg');
  slow();await page.waitForTimeout(150);await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_02.jpg');
  slow=undefined;await page.getByRole('button',{name:'上一张',exact:true}).click();await expect.poll(()=>!!slow).toBe(true);
  await page.getByRole('button',{name:'下一张',exact:true}).click();slow();await page.waitForTimeout(150);await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_02.jpg');
  expect(errors).toEqual([]);
});

test('late favorite metadata cannot replace the photo opened afterwards',async({page})=>{
  const {errors}=await synthetic(page);let finish;
  await page.route('**/api/photos/frame-0',async route=>{
    if(route.request().method()==='PATCH'){await new Promise(resolve=>{finish=resolve});return route.fulfill({json:{...photos[0],favorite:true}});}
    return route.fulfill({json:photos[0]});
  });
  await page.goto('/?page=photos');await page.locator('.photo-image').first().dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();
  await page.locator('.photo-viewer').getByRole('button',{name:'收藏 FRAME_00.jpg',exact:true}).click();await expect.poll(()=>!!finish).toBe(true);
  await page.getByRole('button',{name:'下一张',exact:true}).click();await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_01.jpg');
  finish();await page.waitForTimeout(150);await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_01.jpg');expect(errors).toEqual([]);
});

test('neighbor previews wait for the settled photo and close cancels the next warmup',async({page})=>{
  const {errors}=await synthetic(page),previews=[];
  page.on('request',request=>{const match=new URL(request.url()).pathname.match(/\/photos\/(frame-\d+)\/preview$/);if(match)previews.push(match[1]);});
  await page.goto('/?page=photos');await page.locator('.photo-image').first().dblclick();await expect(page.locator('.photo-viewer')).toBeVisible();
  await page.waitForTimeout(180);expect(previews).toEqual(['frame-0']);
  await expect.poll(()=>previews.includes('frame-1')).toBe(true);expect(previews).not.toContain('frame-2');
  await page.getByRole('button',{name:'查看照片 4',exact:true}).click();await expect(page.locator('.viewer-caption b')).toHaveText('FRAME_03.jpg');
  await page.keyboard.press('Escape');await page.waitForTimeout(450);expect(previews).not.toContain('frame-2');expect(previews).not.toContain('frame-4');expect(errors).toEqual([]);
});


for(const [width,lang] of [[1440,'zh'],[390,'en']])test(`real import task stages and resource queues ${width} ${lang}`,async({page,request},info)=>{
  const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,`task-stages-${width}.jpg`);execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image,ImageDraw; import sys; im=Image.new('RGB',(100,70),'#536d79'); ImageDraw.Draw(im).text((2,2),sys.argv[1],fill='white'); im.save(sys.argv[1])",source]);
  const before=createHash('sha256').update(readFileSync(source)).digest('hex'),job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  await page.setViewportSize({width,height:1000});await page.addInitScript(lang=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');},lang);
  // Enough real, deduplicated imports to exercise the scrolling task list.
  const history=await Promise.all(Array.from({length:12},async()=>await(await request.post('/api/photos/import',{data:{paths:[source]}})).json()));
  await expect.poll(async()=>(await Promise.all(history.map(async j=>(await(await request.get('/api/jobs/'+j.id)).json()).status))).every(status=>status==='completed')).toBe(true);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/?page=photos');await page.getByRole('button',{name:lang==='en'?'Activity center':'活动中心',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:lang==='en'?'Activity center':'活动中心',exact:true});await dialog.locator(`.activity-list [data-task-id="${job.id}"]`).click();
  await expect(dialog.locator('.activity-stages button')).toHaveCount(3);await dialog.locator('.activity-stages button').filter({hasText:lang==='en'?'Verify and index':'校验与入库'}).click();
  await expect(dialog.locator('.activity-detail h3')).toContainText(lang==='en'?'Verify and index':'校验与入库');await expect(dialog.locator(`.activity-list [data-task-id="${job.id}"]`)).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:lang==='en'?'Back to overall task':'返回整体任务',exact:true}).click();await expect(dialog.locator('.activity-detail h3')).toContainText(lang==='en'?'Import':'照片导入');
  await dialog.locator('.activity-resources summary').click();await expect(dialog.locator('.activity-resource-grid p')).toHaveCount(6);
  expect(await dialog.locator('.activity-list>button').evaluateAll(buttons=>buttons.flatMap(button=>{const b=button.getBoundingClientRect();return [...button.children].filter(child=>{const c=child.getBoundingClientRect();return c.top<b.top-.5||c.bottom>b.bottom+.5||c.left<b.left-.5||c.right>b.right+.5;}).map(child=>child.tagName);}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await dialog.screenshot({path:info.outputPath('task-stages.png')});
  await dialog.getByRole('button',{name:lang==='en'?'Close':'关闭',exact:true}).click();await page.getByRole('button',{name:lang==='en'?'Activity center':'活动中心',exact:true}).click();await expect(dialog.locator('.activity-resources')).toHaveJSProperty('open',true);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(before);expect(errors).toEqual([]);
});


for(const total of [10000,50000])for(const layout of ['grid','tiles','justified','waterfall']){
  if(total===50000&&layout==='waterfall')continue; // Existing 19-position test covers this case more deeply.
  test(`${total}-photo ${layout} keeps its rendered and metadata windows bounded`,async({page})=>{
    const {errors}=await synthetic(page),ids=Array.from({length:total},(_,i)=>'large-'+i),batches=[];
    await page.route('**/api/photos/ids?*',route=>route.fulfill({json:{ids}}));
    await page.route('**/api/photos/by-ids',route=>{const asked=route.request().postDataJSON().ids;batches.push(asked.length);return route.fulfill({json:{photos:asked.map(id=>{const i=Number(id.slice(6));return {...photos[0],id,file_name:id+'.jpg',width:[800,1200,2400,1000][i%4],height:[1200,800,700,1000][i%4]};})}});});
    await page.goto('/?page=photos');await page.getByRole('button',{name:'网格显示设置',exact:true}).click();await page.getByLabel('浏览布局',{exact:true}).selectOption(layout);await page.getByRole('button',{name:'网格显示设置',exact:true}).click();const scroller=page.locator('.virtual-gallery > div').first();await expect(scroller).toBeVisible();
    for(const fraction of [.1,.5,.94]){
      const previous=await page.locator('.photo-image').first().getAttribute('aria-label');await scroller.evaluate((node,fraction)=>{node.scrollTop=node.scrollHeight*fraction;},fraction);
      await expect.poll(()=>page.locator('.photo-image').first().getAttribute('aria-label')).not.toBe(previous);await expect.poll(()=>page.locator('.gallery-virtual .vg-placeholder').count()).toBe(0);
      expect(await page.locator('.photo-card').count()).toBeLessThan(180);expect(Number((await page.locator('.vg-total').innerText()).match(/已加载 (\d+)/)?.[1])).toBeLessThanOrEqual(600);
    }
    expect(batches.every(size=>size<=200)).toBe(true);expect(errors).toEqual([]);
  });
}
