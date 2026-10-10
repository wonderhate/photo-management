import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Render the production UI with synthetic API data; never connect to a photo library.
for(const theme of ['light','dark'])for(const width of [1440,390]){
  test(`${theme} cards and controls at ${width}px`,async({page},testInfo)=>{
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
    await page.setViewportSize({width,height:1000});
    await page.addInitScript(theme=>{localStorage.setItem('theme',theme);localStorage.setItem('onboarded','1')},theme);
    const responses={
      '/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{},
      '/library/scan':{job:null},'/jobs':[],
      '/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:[]},
      '/albums':[{id:'test-album',name:'测试影集',type:'normal',count:3,keywords:[],cover_id:null}],
      '/faces/status':{available:true,dependency:true,cached:true},
      '/faces/persons':[{id:'test-person',name:'PersonWithAVeryLongName'.repeat(5),photo_count:3,pending:2}],
    };
    await page.route('**/api/**',async route=>{
      const key=new URL(route.request().url()).pathname.slice(4);
      if(!(key in responses))errors.push(`Unexpected API request: ${key}`);
      await route.fulfill({json:responses[key]??{}});
    });
    async function checkCard(selector){
      const card=page.locator(selector).first();await expect(card).toBeVisible();
      const result=await card.evaluate(card=>{
        const rgb=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const background=luminance(getComputedStyle(card).backgroundColor);
        const contrast=[...card.querySelectorAll('h3,p')].map(el=>{const text=luminance(getComputedStyle(el).color);return(Math.max(text,background)+.05)/(Math.min(text,background)+.05)});
        const bounds=card.getBoundingClientRect();
        const controlsFit=[...card.querySelectorAll('button')].every(el=>{const rect=el.getBoundingClientRect();return rect.left>=bounds.left&&rect.right<=bounds.right+.5&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom+.5});
        return{contrast,controlsFit,overflow:card.scrollWidth>card.clientWidth};
      });
      for(const ratio of result.contrast)expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(result.controlsFit).toBe(true);expect(result.overflow).toBe(false);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`${selector.slice(1)}.png`),fullPage:true});
    }
    const response=await page.goto('/?page=albums');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    await checkCard('.album-card');
    if(width===390)await expect(page.locator('.sidebar nav .nav-child')).toHaveCSS('font-size','0px');
    await page.goto('/faces');await checkCard('.face-card');
    await expect(page.locator('.face-card button')).toHaveCount(4);
    expect(await page.locator('.face-card').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(14);
    // These comma-separated light selectors used to contain literal "L" prefixes.
    await page.goto('/?page=photos');
    const light=theme==='light';
    await expect(page.getByRole('combobox',{name:'照片排序'})).toHaveCSS('color',light?'rgb(51, 53, 47)':'rgb(220, 225, 221)');
    await page.getByRole('button',{name:'网格显示设置',exact:true}).click();
    await expect(page.locator('.display-panel')).toHaveCSS('background-color',light?'rgb(253, 252, 248)':'rgb(30, 36, 32)');
    await page.getByRole('button',{name:'最近操作',exact:true}).click();
    await expect(page.locator('.recent-panel')).toHaveCSS('background-color',light?'rgb(253, 252, 248)':'rgb(30, 36, 32)');
    expect(errors).toEqual([]);
  });
}

test('all pages and watermark workflow under production CSP',async({page,request})=>{
  test.setTimeout(90000);
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
  page.on('response',response=>{if(response.status()>=500)errors.push(`${response.status()} ${response.url()}`)});
  const health=await(await request.get('/api/health')).json();
  expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
  const source=join(health.data_dir,'security-browser-source.jpg');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; exif=Image.Exif(); exif[272]='Test Camera'; exif[36867]='2026:09:29 18:24:00'; Image.new('RGB',(640,480),'orange').save(sys.argv[1],exif=exif)",source]);
  const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
  const before=digest();
  const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=> (await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos')).json()).photos[0];
  await page.addInitScript(()=>{localStorage.setItem('onboarded','1')});
  for(const path of ['/?page=photos','/?page=albums','/?page=smart','/timeline','/faces','/?page=stats','/?page=reports','/watermark/gallery','/?page=settings','/compare']){
    const response=await page.goto(path);
    expect(response.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
  }
  await page.goto('/watermark/workshop?photo='+photo.id);
  const preview=page.getByAltText('水印实时预览');
  await expect(preview).toBeVisible();
  await expect.poll(()=>preview.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'保存到水印图库',exact:true}).click();
  await expect(page).toHaveURL(/draft=/);
  const draftURL=page.url();
  await page.reload();
  await expect(preview).toBeVisible();
  await page.getByRole('button',{name:'标记为待导出',exact:true}).click();
  await page.getByRole('button',{name:'导出当前照片',exact:true}).click();
  await expect(page.locator('.download-result')).toBeVisible();
  const draftId=new URL(draftURL).searchParams.get('draft');
  expect((await(await request.get('/api/watermark/drafts/'+draftId)).json()).status).toBe('exported');
  expect(digest()).toBe(before);
  expect(errors).toEqual([]);
});
