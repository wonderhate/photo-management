import {expect} from '@playwright/test';

export async function exerciseFrameV2(page,lang='zh',info){
  const text=(zh,en)=>lang==='en'?en:zh,frame=page.locator('.frame-editor');
  await frame.getByRole('button',{name:text('22套模板与自定义','22 templates and custom layouts'),exact:true}).click();
  const select=frame.getByRole('combobox',{name:text('模板','Template'),exact:true});
  await expect.poll(()=>select.evaluate(node=>Array.from(node.options).filter(o=>!o.value.startsWith('frame-')).length)).toBe(22);
  for(const id of ['overlay-exif','vbar-right','bar-id']){
    await select.selectOption(id);
    await expect(page.locator('.render-status')).not.toHaveText(/正在渲染|Rendering/);
    await expect.poll(()=>page.locator('.render-stage>img').evaluateAll(images=>images.some(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  }
  await frame.getByText(text('文字内容与自定义字段','Text content and custom tokens'),{exact:true}).click();
  await frame.getByLabel('{title}',{exact:true}).fill('Keep my title');
  await frame.getByRole('button',{name:text('刷新拍摄信息','Refresh capture metadata'),exact:true}).click();
  await expect(frame.getByLabel('{title}',{exact:true})).toHaveValue('Keep my title');
  await frame.getByText(text('保存与管理用户模板','Save and manage user templates'),{exact:true}).click();
  await frame.getByLabel(text('模板名称','Template name'),{exact:true}).fill('Saved frame '+lang);
  await frame.getByRole('button',{name:text('保存为新模板','Save as new template'),exact:true}).click();
  await expect(select.locator('option').filter({hasText:'Saved frame '+lang})).toHaveCount(1);
  await page.getByLabel(/文件格式|File Format|File format/,{exact:true}).selectOption('webp');
  await expect(page.getByLabel(/文件格式|File Format|File format/,{exact:true})).toHaveValue('webp');
  await page.getByRole('button',{name:text('导出当前照片','Export Current Photo'),exact:true}).click();
  await expect(page.locator('.watermark-stage').getByRole('link')).toHaveCount(1);
  await expect(page.locator('.download-result')).toContainText(/\d+ × \d+/);
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect(page.locator('.render-status')).not.toHaveText(/正在渲染|Rendering/);
  await expect.poll(()=>page.locator('.render-stage>img').evaluateAll(images=>images.some(i=>i.complete&&i.naturalWidth>0))).toBe(true);
  if(info){await page.locator('.filmstrip img').first().scrollIntoViewIfNeeded();await expect.poll(()=>page.locator('.filmstrip img').first().evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await page.locator('.render-stage').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('frame-v2-'+lang+'.png')});}
}

export async function syntheticWebM(page){
  return page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#408060';ctx.fillRect(0,0,320,240);
    const stream=c.captureStream(20),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];
    recorder.ondataavailable=e=>parts.push(e.data);
    const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
    for(let i=0;i<12;i++){ctx.fillStyle=i%2?'#408060':'#c09050';ctx.fillRect(i*10,30,40,40);await new Promise(r=>setTimeout(r,50));}
    recorder.stop();await stopped;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(parts,{type:'video/webm'}).arrayBuffer()));
  });
}

export async function exerciseVideoPlayer(page,info){
  const poster=page.locator('.video-poster').first(),posterImage=poster.locator('img');
  await expect.poll(()=>posterImage.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  const cover=await posterImage.getAttribute('src');
  await page.emulateMedia({reducedMotion:'no-preference'});await poster.hover({position:{x:20,y:20}});
  await page.waitForTimeout(650);await expect(posterImage).toHaveAttribute('src',cover);
  await expect(posterImage).not.toHaveAttribute('src',cover,{timeout:15000});
  await page.locator('.topbar').hover();await expect(posterImage).toHaveAttribute('src',cover);
  await page.emulateMedia({reducedMotion:'reduce'});await poster.hover();await page.waitForTimeout(1150);
  await expect(posterImage).toHaveAttribute('src',cover);
  await page.locator('.video-card').first().getByRole('button',{name:'预览下一关键帧',exact:true}).click();
  await expect(posterImage).not.toHaveAttribute('src',cover,{timeout:15000});
  await page.locator('.topbar').hover();await expect(posterImage).toHaveAttribute('src',cover);
  await page.locator('.video-card').first().getByRole('button',{name:'播放',exact:true}).click();
  const dialog=page.getByRole('dialog'),video=dialog.locator('video');
  await expect(video).toBeVisible();await expect.poll(()=>video.evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate(v=>({paused:v.paused,controls:v.controls,autoplay:v.autoplay})) ).toEqual({paused:true,controls:true,autoplay:false});
  if(info)await dialog.screenshot({path:info.outputPath('video-player.png')});
  await dialog.locator('.video-stage').focus();await page.keyboard.press('Space');await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(false);
  await page.keyboard.press('Space');await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
  await dialog.locator('input[type=file]').setInputFiles({name:'synthetic.vtt',mimeType:'text/vtt',buffer:Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nSynthetic subtitle\n')});
  await expect.poll(()=>video.evaluate(v=>v.textTracks[0]?.cues?.length)).toBe(1);
  await expect.poll(()=>video.evaluate(v=>v.textTracks[0]?.mode)).toBe('showing');
  await dialog.getByRole('button',{name:'关闭视频',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.locator('.video-card').first().getByRole('button',{name:'播放',exact:true})).toBeFocused();
}
