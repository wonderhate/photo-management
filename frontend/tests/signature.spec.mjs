import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

for(const [width,theme,lang] of [[1440,'light','zh'],[390,'dark','en']])test.describe(`signature styles ${width}`,()=>{
  test.use({viewport:{width,height:1000}});
  test('artwork choices survive saved drafts and export',async({page,request},info)=>{
    test.setTimeout(120000);
    page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript(({theme,lang})=>{localStorage.setItem('theme',theme);localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1')},{theme,lang});
    const health=await(await request.get('/api/health')).json();
    expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
    const source=join(health.data_dir,`signature-${width}.jpg`);
    execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image; import sys; Image.new('RGB',(960,640),(38,72,int(sys.argv[2])%255)).save(sys.argv[1])",source,String(width)]);
    const job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
    await expect.poll(async()=> (await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
    const photo=(await(await request.get('/api/photos')).json()).photos.find(p=>p.file_name===`signature-${width}.jpg`);
    await page.goto('/watermark/workshop?photo='+photo.id);
    const ui=lang==='en'?{show:'Show Signature',original:'Original Script',fine:'Fine Handwriting',brush:'Brush Script',classic:'Classic Calligraphy',text:'Signature Text',save:'Save to Watermark Gallery',export:'Export Current Photo',ambient:'Ambient Light'}:{show:'显示署名',original:'原版连笔',fine:'细线手写',brush:'毛笔笔触',classic:'经典花体',text:'署名内容',save:'保存到水印图库',export:'导出当前照片',ambient:'沉浸光感'};
    const editor=page.locator('.signature-editor');
    await expect(editor.locator('img')).toHaveCount(8);
    await expect.poll(()=>editor.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
    await page.getByLabel(ui.show,{exact:true}).check();
    const hashes=[];
    for(const [label,style] of [[ui.original,'natural'],[ui.fine,'fine'],[ui.brush,'brush'],[ui.classic,'calligraphy']]){
      const previous=await page.locator('.render-stage>img').getAttribute('src').catch(()=>null);
      const preview=page.waitForResponse(r=>r.url().endsWith('/api/watermark/preview')&&r.request().postDataJSON()?.options.signature_style===style);
      await editor.getByRole('button',{name:label,exact:true}).click();
      const response=await preview;expect(response.ok()).toBe(true);
      await expect(page.locator('.render-stage>img')).not.toHaveAttribute('src',previous||'');
      await expect.poll(()=>page.locator('.render-stage>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
      hashes.push(await page.evaluate(async()=>{const img=document.querySelector('.render-stage>img'),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data))].map(b=>b.toString(16).padStart(2,'0')).join('')}));
      await expect(editor.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
      if(style==='natural')await expect(page.getByLabel(ui.text,{exact:true})).toHaveAttribute('readonly','');
    }
    expect(new Set(hashes).size).toBe(4);
    const chineseStyles=lang==='en'?[['Chinese Brush','chinese_brush'],['Chinese Running Script','chinese_running'],['Chinese Cursive','chinese_cursive'],['Chinese Handwriting','chinese_handwriting']]:[['中文毛笔','chinese_brush'],['中文行书','chinese_running'],['中文草书','chinese_cursive'],['中文手写','chinese_handwriting']];
    await editor.getByRole('button',{name:chineseStyles[0][0],exact:true}).click();
    await expect(page.getByLabel(ui.text,{exact:true})).toHaveValue('光影');
    await page.getByLabel(ui.text,{exact:true}).fill('陈曦 · wonder');
    const chineseHashes=[];
    for(const [label,style] of chineseStyles){
      const previous=await page.locator('.render-stage>img').getAttribute('src');
      const preview=page.waitForResponse(r=>r.url().endsWith('/api/watermark/preview')&&r.request().postDataJSON()?.options.signature_style===style&&r.request().postDataJSON()?.options.signature==='陈曦 · wonder');
      await editor.getByRole('button',{name:label,exact:true}).click();
      expect((await preview).ok()).toBe(true);
      await expect(page.locator('.render-stage>img')).not.toHaveAttribute('src',previous||'');
      await expect.poll(()=>page.locator('.render-stage>img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
      chineseHashes.push(await page.evaluate(async()=>{const img=document.querySelector('.render-stage>img'),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,canvas.width,canvas.height).data))].join(',')}));
      await expect(editor.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
    }
    expect(new Set(chineseHashes).size).toBe(4);
    await page.getByRole('button',{name:ui.save,exact:true}).click();
    await expect(page).toHaveURL(/draft=/);
    const id=new URL(page.url()).searchParams.get('draft');
    await page.reload();await expect(page.getByLabel(ui.text,{exact:true})).toHaveValue('陈曦 · wonder');
    await expect(editor.getByRole('button',{name:chineseStyles[3][0],exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.render-stage>img')).toBeVisible();
    await expect(page.locator('.render-status')).not.toContainText(lang==='en'?'Rendering':'正在渲染');
    await editor.screenshot({path:info.outputPath('signature-styles.png')});
    await page.locator('.render-stage').screenshot({path:info.outputPath('signature-preview.png')});
    await page.getByRole('button',{name:ui.ambient,exact:true}).click();
    await page.getByRole('button',{name:ui.export,exact:true}).click();
    await expect(page.locator('.download-result')).toBeVisible();
    const saved=(await(await request.get('/api/watermark/drafts/'+id)).json()).settings_json;
    expect(saved.signature).toBe('陈曦 · wonder');expect(saved.signature_style).toBe('chinese_handwriting');expect(saved.template).toBe('ambient');
    await page.getByLabel(ui.show,{exact:true}).uncheck();
    await expect(editor.getByRole('button',{name:chineseStyles[3][0],exact:true})).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(lang==='en')expect(await editor.innerText()).not.toMatch(/[\u3400-\u9fff]/u);
    expect(errors).toEqual([]);
  });
});
