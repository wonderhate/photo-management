import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const words=lang=>(zh,en)=>lang==='en'?en:zh;

async function protectLocalFiles(page,lang,theme){
  const denied=[];
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!=='http://127.0.0.1:4185'||!['GET','HEAD'].includes(request.method())){
      denied.push({url:request.url(),method:request.method()});return route.abort();
    }
    return route.continue();
  });
  await page.routeWebSocket('**',socket=>{denied.push({url:socket.url(),method:'WebSocket'});socket.close();});
  await page.addInitScript(({lang,theme})=>{
    localStorage.setItem('lang',lang);localStorage.setItem('theme',theme);
    window.__demoAccess={directories:0,databases:0,privateStorage:0,writes:0};
    window.showDirectoryPicker=async()=>{window.__demoAccess.directories++;throw new Error('A demo must not request a library directory.');};
    window.showSaveFilePicker=async()=>{window.__demoAccess.writes++;throw new Error('A demo must only use browser downloads.');};
    indexedDB.open=()=>{window.__demoAccess.databases++;throw new Error('A demo must not read remembered libraries.');};
    navigator.storage.getDirectory=async()=>{window.__demoAccess.privateStorage++;throw new Error('A demo must not persist in private storage.');};
    if(typeof FileSystemFileHandle!=='undefined')FileSystemFileHandle.prototype.createWritable=async()=>{window.__demoAccess.writes++;throw new Error('Real file writes are forbidden.');};
  },{lang,theme});
  return async()=>{
    expect(denied,'No cloud requests, writes or WebSockets are allowed during the demo.').toEqual([]);
    expect(await page.evaluate(()=>window.__demoAccess)).toEqual({directories:0,databases:0,privateStorage:0,writes:0});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await expect(page.locator('.error-box:visible')).toHaveCount(0);
  };
}

async function syntheticImage(page,name='synthetic-local.png',alternate=false,mimeType='image/png'){
  const bytes=await page.evaluate(async({alternate,mimeType})=>{
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=320;
    const context=canvas.getContext('2d'),gradient=context.createLinearGradient(0,0,512,320);
    gradient.addColorStop(0,alternate?'#c45f38':'#2b5974');gradient.addColorStop(1,alternate?'#245f39':'#dac092');
    context.fillStyle=gradient;context.fillRect(0,0,512,320);context.fillStyle='#f0cb64';context.fillRect(alternate?25:285,60,100,90);
    return [...new Uint8Array(await(await new Promise(resolve=>canvas.toBlob(resolve,mimeType,.95))).arrayBuffer())];
  },{alternate,mimeType});
  return {name,mimeType,buffer:Buffer.from(bytes)};
}

async function publishedSample(page){
  const file=await syntheticImage(page,'synthetic-owner.jpg',false,'image/jpeg'),digest=sha(file.buffer),src='/demo/images/'+digest+'.jpg';
  await page.route('**/demo/sample.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,src,width:512,height:320,sha256:digest})}));
  await page.route('**'+src,route=>route.fulfill({contentType:'image/jpeg',body:file.buffer}));
  return file;
}

async function imageDigest(image){
  await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  return image.evaluate(async img=>{
    const canvas=new OffscreenCanvas(img.naturalWidth,img.naturalHeight),context=canvas.getContext('2d');context.drawImage(img,0,0);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',context.getImageData(0,0,canvas.width,canvas.height).data))].join(',');
  });
}

async function openFile(page,file){
  await page.locator('.editor-toolbar input[type=file]').setInputFiles(file);
  await expect(page.locator('.edit-image img')).toBeVisible();
  await expect.poll(()=>page.locator('.edit-image img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
}

async function advanceToWatermark(page,text){
  const next=page.getByRole('button',{name:text('下一步：水印工坊','Next: Watermark Workshop'),exact:true});
  await expect(next).toBeEnabled();await next.click();
  await expect(page.getByRole('heading',{name:text('2. 水印工坊','2. Watermark Workshop'),exact:true})).toBeVisible();
  await expect(page.locator('.render-stage>img')).toBeVisible();
}

async function advanceToDownload(page,text){
  await page.getByRole('button',{name:text('下一步：下载作品','Next: Download your image'),exact:true}).click();
  await expect(page.getByRole('heading',{name:text('3. 下载作品','3. Download your image'),exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.demo-stage img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
}

for(const [lang,width,theme,format]of [['zh',1440,'dark','png'],['en',390,'light','jpg']])test(`the published owner sample uses the complete darkroom and watermark pipeline before downloading ${lang}`,async({page},info)=>{
  test.setTimeout(120000);
  const text=words(lang),check=await protectLocalFiles(page,lang,theme),downloads=[];page.on('download',download=>downloads.push(download));
  const file=await publishedSample(page),sourceHash=sha(file.buffer);
  await page.setViewportSize({width,height:1050});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?local=1&demo=1');
  await expect(page.getByRole('heading',{name:text('1. 光影暗房','1. Lumina Darkroom'),exact:true})).toBeVisible();
  const image=page.locator('.edit-image img'),original=await imageDigest(image),exposure=page.getByRole('slider',{name:text('曝光 EV','Exposure EV'),exact:true});
  await expect(image).toHaveJSProperty('naturalWidth',512);await expect(image).toHaveJSProperty('naturalHeight',320);
  await exposure.focus();for(let i=0;i<5;i++)await exposure.press('ArrowRight');await expect(exposure).toHaveValue('0.5');
  await expect.poll(()=>imageDigest(image)).not.toBe(original);
  const edited=await imageDigest(image);
  await page.getByRole('button',{name:text('撤销编辑','Undo edit'),exact:true}).click();
  await expect(exposure).toHaveValue('0.4');
  await page.getByRole('button',{name:text('重做编辑','Redo edit'),exact:true}).click();await expect(exposure).toHaveValue('0.5');
  await expect.poll(()=>imageDigest(image)).toBe(edited);
  await page.getByRole('button',{name:text('查看原图','Show original'),exact:true}).click();await expect.poll(()=>imageDigest(image)).toBe(original);
  await page.getByRole('button',{name:text('显示编辑效果','Show edits'),exact:true}).click();await expect.poll(()=>imageDigest(image)).toBe(edited);
  await page.locator('.composition-panel>summary').click();await page.getByRole('combobox',{name:text('裁剪比例','Crop ratio'),exact:true}).selectOption('1');
  await expect.poll(()=>image.evaluate(img=>img.naturalWidth===img.naturalHeight)).toBe(true);
  await page.getByRole('button',{name:text('撤销编辑','Undo edit'),exact:true}).click();await expect(image).toHaveJSProperty('naturalWidth',512);await expect(image).toHaveJSProperty('naturalHeight',320);
  await page.getByRole('button',{name:text('重做编辑','Redo edit'),exact:true}).click();await expect.poll(()=>image.evaluate(img=>img.naturalWidth===img.naturalHeight)).toBe(true);
  // These are the real editor panels, rather than a second reduced demo control set.
  await expect(page.locator('.edit-controls').getByText(text('曲线与 HSL','Curves & HSL'),{exact:true})).toBeVisible();
  await expect(page.locator('.edit-controls').getByText(text('细节','Detail'),{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath(`demo-darkroom-${lang}.png`),fullPage:true,animations:'disabled'});
  expect(downloads).toHaveLength(0);await advanceToWatermark(page,text);
  await expect(page.getByRole('button',{name:/送入水彩|Send to watercolor/})).toHaveCount(0);
  if(lang==='zh'){
    const frame=page.locator('.frame-editor');await frame.getByRole('button',{name:'22套模板与自定义',exact:true}).click();
    const select=frame.getByRole('combobox',{name:'模板',exact:true});await expect(select.locator('optgroup').first().locator('option')).toHaveCount(22);
    await select.selectOption('bar-id');await frame.getByText('文字内容与自定义字段',{exact:true}).click();
    await frame.getByLabel('{title}',{exact:true}).fill('Synthetic session title');
  }else{
    await page.getByRole('checkbox',{name:'Show Signature',exact:true}).check();await page.getByLabel('Signature Text',{exact:true}).fill('Synthetic Author');
    await page.getByRole('button',{name:'wonder Fine Handwriting',exact:true}).click();
  }
  await page.getByLabel(/文件格式|File Format|File format/).selectOption(format);
  expect(downloads).toHaveLength(0);await page.screenshot({path:info.outputPath(`demo-watermark-${lang}.png`),fullPage:true,animations:'disabled'});
  await advanceToDownload(page,text);expect(downloads).toHaveLength(0);
  const contrast=await page.locator('.demo-download').evaluate(link=>{
    const style=getComputedStyle(link),luminance=color=>{
      const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
      return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
    },a=luminance(style.color),b=luminance(style.backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });expect(contrast,'The final download action must have readable text in both themes').toBeGreaterThanOrEqual(4.5);
  const material=await page.locator('.demo-stage').evaluate(panel=>{
    const image=panel.querySelector('img'),style=getComputedStyle(image),surface=getComputedStyle(panel);
    return {material:panel.getAttribute('data-liquid-glass'),backdrop:surface.backdropFilter,imageFilter:style.filter,imageBackdrop:style.backdropFilter};
  });
  expect(material.material).toBe('panel');expect(material.backdrop).toMatch(/blur\([1-9][\d.]*px\)/);expect(material.imageFilter).toBe('none');expect(material.imageBackdrop).toBe('none');
  const displayed=await page.locator('.demo-stage img').evaluate(async img=>[...new Uint8Array(await(await fetch(img.src)).arrayBuffer())]);
  const event=page.waitForEvent('download');await page.getByRole('link',{name:text('下载作品','Download image'),exact:true}).click();const download=await event,bytes=readFileSync(await download.path());
  expect(download.suggestedFilename()).toMatch(format==='png'?/\.png$/:/\.jpe?g$/);expect(sha(bytes)).toBe(sha(Buffer.from(displayed)));expect(sha(bytes)).not.toBe(sourceHash);
  if(format==='png')expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));else expect(bytes.subarray(0,2)).toEqual(Buffer.from([255,216]));
  expect(sha(file.buffer)).toBe(sourceHash);await check();await page.screenshot({path:info.outputPath(`demo-download-${lang}.png`),fullPage:true,animations:'disabled'});
});

test('a missing owner sample falls back locally and a new session clears its prior edits',async({page})=>{
  test.setTimeout(90000);const check=await protectLocalFiles(page,'zh','dark');await page.route('**/demo/sample.json',route=>route.fulfill({status:404,body:''}));await page.goto('/?local=1&demo=1');
  await expect(page.locator('.edit-image img')).toBeVisible();await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalWidth',1200);await expect(page.locator('.edit-image img')).toHaveJSProperty('naturalHeight',800);
  const exposure=page.getByRole('slider',{name:'曝光 EV',exact:true});await exposure.press('ArrowRight');await expect(exposure).toHaveValue('0.1');
  const accept=dialog=>dialog.accept();page.on('dialog',accept);try{await page.getByRole('button',{name:'返回开始页',exact:true}).click();await expect(page.locator('.browser-start-card')).toBeVisible();}finally{page.off('dialog',accept);}
  await page.getByRole('button',{name:'用示例体验',exact:true}).click();await expect(page.locator('.edit-image img')).toBeVisible();await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('0');await check();
});

test('returning to edit preserves the pipeline and replacing the source invalidates its old output',async({page})=>{
  test.setTimeout(120000);const text=words('zh'),check=await protectLocalFiles(page,'zh','dark'),first=await publishedSample(page),firstHash=sha(first.buffer);await page.goto('/?local=1&demo=1');await expect(page.locator('.edit-image img')).toBeVisible();
  const exposure=page.getByRole('slider',{name:'曝光 EV',exact:true});await exposure.press('ArrowRight');await advanceToWatermark(page,text);
  await page.getByRole('checkbox',{name:'显示署名',exact:true}).check();await page.getByLabel('署名内容',{exact:true}).fill('保留这枚署名');
  await advanceToDownload(page,text);const oldOutput=await page.locator('.demo-stage img').getAttribute('src');
  await page.getByRole('button',{name:'返回水印工坊',exact:true}).click();await expect(page.getByLabel('署名内容',{exact:true})).toHaveValue('保留这枚署名');
  await page.getByRole('button',{name:'返回光影暗房',exact:true}).click();await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('0.1');
  const second=await syntheticImage(page,'synthetic-replacement.png',true),secondHash=sha(second.buffer);page.once('dialog',dialog=>dialog.accept());await openFile(page,second);
  await expect(page.getByRole('slider',{name:'曝光 EV',exact:true})).toHaveValue('0');await expect(page.locator('.demo-stage img')).toHaveCount(0);
  await advanceToWatermark(page,text);await expect(page.locator('.watermark-caption h3')).toContainText('synthetic-replacement');
  await page.getByLabel(/文件格式|File Format|File format/).selectOption('png');await advanceToDownload(page,text);await expect(page.locator('.demo-stage img')).not.toHaveAttribute('src',oldOutput);
  expect(sha(first.buffer)).toBe(firstHash);expect(sha(second.buffer)).toBe(secondHash);await check();
});
