import {test,expect} from '@playwright/test';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('../dist-showcase/portfolio/manifest.json',import.meta.url),'utf8'));
const windowsRelease=JSON.parse(readFileSync(new URL('../src/browser/windows-release.json',import.meta.url),'utf8'));

test('public navigation keeps its remaining destinations and homepage anchors never become missing pages',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const [path,section]of [['/#lumina','lumina'],['/#works','works'],['/#/#lumina','lumina'],['/en/#lumina','lumina']]){
    await page.goto(path);await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.public-state')).toHaveCount(0);
    await expect(page.locator('#'+section)).toBeInViewport();
    const links=page.locator('header.hdr nav a');
    await expect(links).toHaveCount(3);
    await expect(links.nth(1)).toHaveAttribute('href',path.startsWith('/en/')?'/en/about/':'/about/');
    await expect(links.nth(2)).toHaveAttribute('href','/windows.html');
  }
  await page.goto('/#/photos');
  await expect(page.locator('.public-lumina-actions a').first()).toHaveAttribute('href',/local=1/);
  await page.locator('header.hdr nav a').first().click();
  await expect(page).toHaveURL(/#\/photos$/);await expect(page.getByRole('searchbox')).toBeVisible();
  await page.locator('.home-brand').click();await page.locator('header.hdr nav a').first().click();
  await expect(page).toHaveURL(/#works$/);await expect(page.locator('#works')).toBeInViewport();
  await page.reload();await expect(page.locator('#works')).toBeInViewport();
  for(const path of ['/about/','/en/lumina/']){
    await page.goto(path);const links=page.locator('header.public-header nav a');
    await expect(links).toHaveCount(3);await expect(links.last()).toHaveAttribute('href','/windows.html');
    await expect(links.filter({hasText:/光影集|Lumina/})).toHaveCount(0);
  }
});

test('personal and project pages have readable bilingual HTML, share metadata and real sitemap URLs',async({request,browser})=>{
  for(const path of ['/','/en/','/about/','/en/about/','/lumina/','/en/lumina/']){
    const response=await request.get(path);expect(response.status()).toBe(200);
    const text=await response.text();expect(text).toContain('<h1>');expect(text).toContain('Wonder');expect(text).toContain(`rel="canonical" href="https://photomanagement.online${path}"`);
    expect(text).toContain('property="og:image"');expect(text).toContain('hreflang="en"');expect(text).not.toContain('计算机专业');
    if(path.startsWith('/en/'))expect(text).toContain('<html lang="en">');
  }
  const xml=await request.get('/sitemap.xml');expect(xml.headers()['content-type']).toContain('application/xml');
  for(const [,url]of (await xml.text()).matchAll(/<loc>(.*?)<\/loc>/g)){expect(url).not.toContain('#');expect((await request.get(new URL(url).pathname)).status()).toBe(200);}
  expect(await(await request.get('/robots.txt')).text()).toContain('Sitemap: https://photomanagement.online/sitemap.xml');
  const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();
  try{await page.goto('http://127.0.0.1:4186/');await expect(page.getByText('我是 Wonder，喜欢摄影', {exact:false})).toBeVisible();await page.goto('http://127.0.0.1:4186/en/lumina/');await expect(page.getByRole('heading',{level:1})).toHaveText('From a folder of photos to an image ready to share.');await expect(page.getByText('1706023204',{exact:true})).toBeVisible();}finally{await context.close();}
});

test('Wonder contact and project introductions work on narrow screens with no uploads',async({page,context},info)=>{
  const requests=[],errors=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.setViewportSize({width:390,height:844});
  await page.goto('/about/');await expect(page.getByRole('heading',{level:1})).toHaveText('你好，我是 Wonder。');
  await page.getByRole('button',{name:'复制号码',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('1706023204');
  await expect(page.getByRole('status')).toContainText('QQ 已复制');
  await page.getByRole('button',{name:'切换到亮色主题'}).click();await expect(page.locator('.public-notes')).toHaveAttribute('data-theme','light');
  await page.screenshot({path:info.outputPath('wonder-about-mobile-light.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'了解光影集项目',exact:false}).click();
  await page.getByRole('link',{name:'EN',exact:true}).click();await expect(page).toHaveURL(/\/en\/lumina\/$/);await page.reload();
  await expect(page.getByRole('heading',{level:1})).toHaveText('From a folder of photos to an image ready to share.');await expect(page.locator('.public-notes')).toHaveAttribute('data-theme','light');
  for(const image of await page.locator('.notes-demo img').all()){await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);}
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('wonder-project-mobile-en.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.notes-intro').getByRole('link',{name:/^Try the sample/})).toHaveAttribute('href','/?local=1&demo=1&lang=en#/');
  await expect(page.locator('.notes-intro').getByRole('link',{name:/^Open browser tools/})).toHaveAttribute('href','/?local=1&lang=en#/');
  expect(requests.filter(r=>r.method!=='GET'||!r.url.startsWith('http://127.0.0.1:4186')||r.url.includes('/api/'))).toEqual([]);expect(errors).toEqual([]);
});
async function readyImages(page){for(const img of await page.locator('.public-image img').all()){await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);}await page.evaluate(()=>scrollTo(0,0));}

test('anonymous visitors browse, search, open collections and deep-linked photographs',async({page},info)=>{
  expect(existsSync(new URL('../dist-showcase/private-test.txt',import.meta.url))).toBe(false);
  expect(readdirSync(new URL('../dist-showcase/portfolio/images/',import.meta.url)).sort()).toEqual([...new Set(catalog.photos.flatMap(p=>[p.src,p.thumbnail]).map(p=>p.split('/').at(-1)))].sort());
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.addInitScript(()=>{window.__directoryPrompts=0;window.showDirectoryPicker=()=>{window.__directoryPrompts++;throw Error('Public visitors must not need directory access');};});
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await expect(page.locator('.hero')).toBeVisible();await expect(page.locator('.piece')).toHaveCount(2);
  await expect(page.locator('.tile-more')).toHaveAttribute('href',/#\/photos$/);
  await expect(page.locator('header.hdr nav').getByRole('link',{name:'Windows 下载',exact:true})).toHaveAttribute('href','/windows.html');
  await expect(page.getByRole('link',{name:'进入光影集',exact:true})).toHaveCount(0);
  await expect(page.locator('.public-site')).not.toContainText('\\n');
  await page.evaluate(()=>scrollTo(0,0));
  await readyImages(page);const cards=await page.locator('.piece').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().x));expect(cards[1]).toBeGreaterThan(cards[0]);await page.screenshot({path:info.outputPath('public-home-desktop.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('link',{name:'全部作品',exact:true}).first().click();await expect(page).toHaveURL(/#\/photos$/);
  await page.getByRole('searchbox').fill('山间');await expect(page.locator('.public-photo')).toHaveCount(1);await page.getByRole('searchbox').fill('不存在的标签');await expect(page.getByText('没有匹配的作品')).toBeVisible();await page.getByRole('searchbox').fill('');
  await page.screenshot({path:info.outputPath('public-gallery-desktop.png'),fullPage:true,animations:'disabled'});await page.locator('.public-photo').first().click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page).toHaveURL(/photo=frame-0001/);
  await page.keyboard.press('ArrowRight');await expect(page.getByRole('dialog').getByRole('heading',{name:'暮色之下',exact:true})).toBeVisible();await page.getByRole('button',{name:'照片信息',exact:true}).click();await page.getByRole('button',{name:'放大照片'}).click();await expect(page.locator('.public-lightbox-stage')).toHaveClass(/is-zoomed/);await page.getByRole('button',{name:'缩小至适合窗口'}).click();await page.screenshot({path:info.outputPath('public-lightbox-desktop.png')});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.public-photo').first()).toBeFocused();
  await page.goto('/#/albums');await page.locator('.public-collection').click();await expect(page.locator('.public-photo')).toHaveCount(2);await page.reload();await expect(page.getByRole('heading',{name:'山野来信',exact:true})).toBeVisible();
  await page.goto('/#/photos?photo=frame-0001');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(/#\/photos$/);
  await page.goto('/#/photos?photo=missing');await expect(page.getByText('这张照片尚未发布或已移除。')).toBeVisible();await page.getByRole('button',{name:'继续浏览'}).click();
  expect(await page.evaluate(()=>window.__directoryPrompts)).toBe(0);expect(errors).toEqual([]);expect(requests.filter(r=>r.method!=='GET'||!r.url.startsWith('http://127.0.0.1:4186')||r.url.includes('/api/'))).toEqual([]);
});

test('the homepage hero uses the first cover and the selection shows six pieces plus a library tile',async({page})=>{
  const photos=Array.from({length:8},(_,i)=>({...catalog.photos[i%catalog.photos.length],id:`cover-${i+1}`,title:`Cover ${i+1}`}));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.route('**/portfolio/manifest.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...catalog,photos,albums:[],featuredIds:photos.map(p=>p.id),coverIds:photos.slice(0,6).map(p=>p.id)})}));
  await page.goto('/');
  await expect(page.locator('.hero img')).toHaveAttribute('src',photos[0].src);
  await expect(page.locator('.hero h1')).toContainText('追光');
  await expect(page.locator('.piece')).toHaveCount(6);
  await expect(page.locator('.tile-more')).toBeVisible();
  await expect(page.getByRole('button',{name:/封面轮播|上一张封面/})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.reload();
  await expect(page.locator('.hero img')).toHaveAttribute('src',photos[0].src);
  await expect(page.locator('.rv').first()).toHaveClass(/in/);
});

test('mobile, English, light theme, reduced motion and keyboard focus work',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await expect(page.locator('.piece')).toHaveCount(2);await readyImages(page);await page.screenshot({path:info.outputPath('public-home-mobile.png'),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'播放封面轮播'})).toHaveCount(0);
  await page.locator('.tile-more').click();await expect(page.locator('.public-photo')).toHaveCount(2);await page.screenshot({path:info.outputPath('public-gallery-mobile.png'),animations:'disabled'});await page.goto('/');
  await page.locator('.piece').first().click();const d=page.getByRole('dialog');await expect(d).toBeVisible();await page.screenshot({path:info.outputPath('public-lightbox-mobile.png')});await page.getByRole('button',{name:'关闭照片'}).focus();await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('dialog'))).toBe(true);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'切换到英文'}).click();await page.getByRole('button',{name:'Switch to light theme'}).click();await page.goto('/en/#/albums');await page.reload();await expect(page.getByRole('heading',{name:'Collections',exact:true})).toBeVisible();await expect(page.locator('.public-site')).toHaveAttribute('data-theme','light');await page.screenshot({path:info.outputPath('public-collections-light-en-mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('link',{name:'Lumina project',exact:true})).toHaveAttribute('href','/en/lumina/');
  await page.goto('/?local=1#/tools');await expect(page.getByRole('heading',{name:'Lumina · Browser Local Library'})).toBeVisible();
});

test('loading, failure, empty catalog and broken images have recoverable states',async({page})=>{
  let release;const hold=new Promise(r=>release=r);let fail=true;
  await page.route('**/portfolio/manifest.json',async r=>{await hold;await r.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(catalog)});});
  await page.goto('/');await expect(page.getByText('正在展开光影…')).toBeVisible();release();await expect(page.getByRole('alert')).toContainText('暂时无法读取作品');fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.locator('.piece')).toHaveCount(2);
  await page.unroute('**/portfolio/manifest.json');await page.route('**/portfolio/manifest.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...catalog,photos:[],albums:[],featuredIds:[]})}));await page.goto('/#/photos');await page.reload();await expect(page.getByText('这里还没有发布照片。欢迎稍后再来。')).toBeVisible();await expect(page.getByRole('button',{name:'新建本地图库'})).toHaveCount(0);
  await page.unroute('**/portfolio/manifest.json');await page.route('**/portfolio/images/**',r=>r.fulfill({status:404,body:''}));await page.goto('/#/photos');await page.reload();await expect(page.locator('.public-gallery .public-image-error')).toHaveCount(2);await page.locator('.public-photo').first().click();await page.getByRole('button',{name:'照片信息',exact:true}).click();await page.unroute('**/portfolio/images/**');await page.getByRole('button',{name:'重新加载图片'}).click();await expect.poll(()=>page.locator('.public-lightbox-stage img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
});

test('public deployment has no publisher UI or write endpoints',async({page,request})=>{
  const before=await (await request.get('/portfolio/manifest.json')).text();
  expect(readdirSync(new URL('../dist-showcase/assets/',import.meta.url)).some(p=>/^PublishPortfolio-/.test(p))).toBe(false);
  for(const method of ['POST','PUT','PATCH','DELETE']){
    const result=await request.fetch('/portfolio/manifest.json',{method,data:{title:'synthetic rejected write'}});
    expect(result.status()).toBe(405);
  }
  for(const path of ['/api/portfolio','/admin','/.local-notes/portfolio-source.json','/library.json'])expect((await request.get(path)).status()).toBe(404);
  expect(await (await request.get('/portfolio/manifest.json')).text()).toBe(before);
  await page.addInitScript(()=>{
    FileSystemHandle.prototype.queryPermission=async()=> 'granted';FileSystemHandle.prototype.requestPermission=async()=> 'granted';
    window.showDirectoryPicker=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-visitor-library',{create:true});
    localStorage.setItem('onboarded','1');
  });
  await page.goto('/?local=1#/?publish=1');await page.getByRole('button',{name:'新建本地图库',exact:true}).click();
  await expect(page.locator('.app-shell')).toBeVisible();await expect(page.getByRole('button',{name:'导出公开作品',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'更新作品展示'})).toHaveCount(0);
});

test('service worker never stores public photographs or the mutable manifest',async({browser})=>{
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
  try{await page.goto('http://127.0.0.1:4186/');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await expect(page.locator('.piece')).toHaveCount(2);const paths=await page.evaluate(async()=>{const urls=[];for(const k of await caches.keys())for(const r of await(await caches.open(k)).keys())urls.push(new URL(r.url).pathname);return urls;});expect(paths.some(p=>p.startsWith('/portfolio/'))).toBe(false);}finally{await context.close();}
});

for(const [lang,theme,width]of [['zh','dark',1440],['en','light',390]])test(`public first-use choices and real sample previews stay clear ${lang}`,async({page},info)=>{
  await page.addInitScript(({lang,theme})=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);window.__directoryPrompts=0;window.showDirectoryPicker=()=>{window.__directoryPrompts++;throw Error('A sample must not request a photo folder');};},{lang,theme});
  await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto(lang==='en'?'/en/':'/');
  const hero=page.locator('.hero');
  await expect(hero.getByRole('link',{name:lang==='zh'?'浏览摄影作品':'Explore photographs',exact:true})).toHaveAttribute('href',/#works$/);
  await expect(hero.getByRole('link',{name:lang==='zh'?'打开浏览器工具':'Open browser tools',exact:true})).toHaveAttribute('href',`/?local=1&lang=${lang}#/`);
  await expect(hero.locator('.entry-support')).toContainText('Chrome / Edge');
  await page.screenshot({path:info.outputPath(`first-use-home-${lang}-${width}.png`),animations:'disabled'});
  const steps=page.locator('.product-steps button'),preview=page.locator('.product-preview img');
  for(const [index,name,w,h]of [[0,'original',1200,800],[1,'adjusted',1200,800],[2,'framed',1308,998]]){
    await steps.nth(index).click();await expect(steps.nth(index)).toHaveAttribute('aria-pressed','true');
    await expect(preview).toHaveAttribute('src',`/demo/lumina-${name}.png`);
    await expect.poll(()=>preview.evaluate(img=>[img.naturalWidth,img.naturalHeight])).toEqual([w,h]);
  }
  await page.locator('.product-preview').evaluate(node=>scrollTo(0,node.getBoundingClientRect().top+scrollY-document.querySelector('header.hdr').getBoundingClientRect().height-30));
  await page.screenshot({path:info.outputPath(`first-use-real-preview-${lang}-${width}.png`),animations:'disabled'});
  expect(await page.locator('.product-step-number').first().evaluate(node=>node.getBoundingClientRect().height<=Number.parseFloat(getComputedStyle(node).lineHeight)+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await hero.getByRole('link',{name:lang==='zh'?'用示例体验':'Try the sample',exact:true}).click();
  await expect(page).toHaveURL(/local=1&demo=1/);
  await expect(page.getByRole('heading',{name:lang==='zh'?'1. 光影暗房':'1. Lumina Darkroom',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:lang==='zh'?'打开照片 / RAW':'Open photo / RAW',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>window.__directoryPrompts)).toBe(0);
});

for(const [lang,theme,width]of [['zh','dark',1440],['en','light',390]])test(`download decisions are available before secondary content ${lang}`,async({page},info)=>{
  await page.addInitScript(({lang,theme})=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);},{lang,theme});
  await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/windows.html');
  const installer=windowsRelease.files.find(file=>file.kind==='installer'),primary=page.locator('.download-hero-button');
  await expect(primary).toBeInViewport();await expect(primary).toHaveAttribute('href',windowsRelease.baseUrl+installer.name);
  await expect(page.locator('.download-hero-meta')).toContainText(`v${windowsRelease.displayVersion}`);
  await expect(page.locator('.download-hero-meta')).toContainText(`${(installer.bytes/1024/1024).toFixed(1)} MiB`);
  await expect(page.locator('.download-hero-notice')).toContainText(lang==='zh'?'未签名':'unsigned');
  await expect(page.locator('.download-back')).toHaveText(lang==='zh'?'返回摄影主页':'Back to the portfolio');
  await expect(page.locator('.download-back')).toHaveAttribute('href',lang==='zh'?'/':'/en/');
  await page.screenshot({path:info.outputPath(`first-use-download-hero-${lang}-${width}.png`),animations:'disabled'});
  expect(await page.locator('.download-bottom-grid').evaluate(node=>!!(document.querySelector('#packages').compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('#linux')).not.toHaveAttribute('open','');await expect(page.locator('#linux .download-package')).not.toBeVisible();
  await expect(page.locator('.download-comparison')).toContainText(lang==='zh'?'两版图库不能直接互换或覆盖':'Libraries are not directly interchangeable');
  await page.locator('.download-compare').evaluate(node=>scrollTo(0,node.getBoundingClientRect().top+scrollY-document.querySelector('.download-header').getBoundingClientRect().height-30));
  await page.screenshot({path:info.outputPath(`first-use-comparison-${lang}-${width}.png`),animations:'disabled'});
  await page.locator('#linux>summary').click();await expect(page.locator('#linux .download-package')).toBeVisible();
  await expect(page.locator('#linux')).toContainText('2.6.1');await page.locator('#linux>summary').click();
  await expect(page.locator('.download-footer a').last()).toHaveAttribute('href',`/?local=1&lang=${lang}#/`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.route(windowsRelease.baseUrl+installer.name,route=>route.fulfill({contentType:'application/octet-stream',body:'synthetic installer fixture',headers:{'Content-Disposition':`attachment; filename="${installer.name}"`}}));
  const pending=page.waitForEvent('download');await primary.click();const download=await pending;
  expect(download.suggestedFilename()).toBe(installer.name);expect(readFileSync(await download.path()).toString()).toBe('synthetic installer fixture');
});
