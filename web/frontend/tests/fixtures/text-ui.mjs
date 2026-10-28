import {expect} from '@playwright/test';
export async function imageDigest(locator){
  let digest=null;
  // A preview revision can replace/revoke its prior URL while decode is pending.
  // Wait for one stable decoded revision; persistent image errors still fail.
  await expect.poll(async()=>{digest=await locator.evaluate(async image=>{
    const source=image.currentSrc;if(!source)return null;
    try{await image.decode();}catch(error){if(error.name==='EncodingError')return null;throw error;}
    if(source!==image.currentSrc||!image.naturalWidth)return null;
    const c=new OffscreenCanvas(image.naturalWidth,image.naturalHeight),ctx=c.getContext('2d');ctx.drawImage(image,0,0);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,c.width,c.height).data))].join(',');
  });return digest!==null;},{timeout:5000}).toBe(true);return digest;
}
export async function exerciseTextUI(page,info,lang='zh',route='/#/tools/edit'){
  const t=(zh,en)=>lang==='en'?en:zh,image=page.locator('.edit-image img'),original=await imageDigest(image),name=await image.getAttribute('alt');
  await page.getByRole('button',{name:t('添加文字','Add text'),exact:true}).click();const content=page.getByRole('textbox',{name:t('文字内容','Text content'),exact:true});await content.fill('光影集 Photography\nÁg élan 👩🏽‍💻');
  const preset=page.getByRole('combobox',{name:t('文字样式预设','Text style preset'),exact:true});await preset.selectOption('seal');await preset.selectOption('dune');await expect(content).toHaveValue('光影集 Photography\nÁg élan 👩🏽‍💻');await page.getByRole('combobox',{name:t('文字字体','Text font'),exact:true}).selectOption('chinese_handwriting');const size=page.getByRole('spinbutton',{name:t('文字字号','Text size'),exact:true});await size.fill('220');await size.blur();
  const ready=()=>expect(page.locator('[data-text-layer]').first()).toHaveAttribute('aria-disabled','false'),showCanvas=()=>page.locator('.text-canvas').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await ready();await expect.poll(()=>imageDigest(image)).not.toBe(original);
  await page.getByRole('button',{name:t('复制','Copy'),exact:true}).click();await page.getByRole('button',{name:t('删除文字','Delete text'),exact:true}).click();await expect(page.locator('.text-layer-list li')).toHaveCount(0);await page.getByRole('button',{name:t('粘贴','Paste'),exact:true}).click();await expect(content).toHaveValue('光影集 Photography\nÁg élan 👩🏽‍💻');await ready();
  await page.getByRole('button',{name:t('复制图层','Duplicate layer'),exact:true}).click();await expect(page.locator('.text-layer-list li')).toHaveCount(2);
  await page.getByRole('button',{name:t('下移一层','Send backward'),exact:true}).click();await page.getByRole('button',{name:t('锁定文字图层 ','Lock text layer ')+'1',exact:true}).click();await expect(content).toBeDisabled();await page.getByRole('button',{name:t('锁定文字图层 ','Lock text layer ')+'1',exact:true}).click();await expect(content).toBeEnabled();
  await page.getByRole('button',{name:t('隐藏文字图层 ','Hide text layer ')+'1',exact:true}).click();await page.getByRole('button',{name:t('隐藏文字图层 ','Hide text layer ')+'2',exact:true}).click();await expect.poll(()=>imageDigest(image)).toBe(original);
  await page.getByRole('button',{name:t('隐藏文字图层 ','Hide text layer ')+'1',exact:true}).click();await page.getByRole('button',{name:t('删除文字','Delete text'),exact:true}).click();await expect(page.locator('.text-layer-list li')).toHaveCount(1);
  const undo=page.getByRole('button',{name:t('撤销编辑','Undo edit'),exact:true}),redo=page.getByRole('button',{name:t('重做编辑','Redo edit'),exact:true});await undo.click();await expect(page.locator('.text-layer-list li')).toHaveCount(2);await redo.click();await expect(page.locator('.text-layer-list li')).toHaveCount(1);
  await page.getByRole('button',{name:t('隐藏文字图层 ','Hide text layer ')+'1',exact:true}).click();await ready();
  const x=page.getByRole('spinbutton',{name:t('文字横向位置','Text position X'),exact:true}),beforeX=await x.inputValue(),hit=page.locator('[data-text-layer]');await showCanvas();const rect=await hit.boundingBox();
  if(lang==='en'){const cdp=await page.context().newCDPSession(page),start={x:rect.x+rect.width/2,y:rect.y+rect.height/2};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+25,y:start.y+12}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+35,rect.y+rect.height/2+20,{steps:5});await page.mouse.up();}
  await expect(x).not.toHaveValue(beforeX);const movedX=await x.inputValue();await undo.click();await expect(x).toHaveValue(beforeX);await redo.click();await expect(x).toHaveValue(movedX);await ready();
  await showCanvas();await expect(page.locator('[data-layer-handle]')).toHaveCount(8);const matrix=hit.locator('..'),beforeScale=await matrix.getAttribute('transform');const handle=await page.locator('[data-text-handle=size]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+22,handle.y+handle.height/2+14,{steps:3});await page.mouse.up();await expect(matrix).not.toHaveAttribute('transform',beforeScale);await expect(size).toHaveValue('220');await undo.click();await expect(matrix).toHaveAttribute('transform',beforeScale);await ready();
  const rotation=page.getByRole('spinbutton',{name:t('文字旋转','Text rotation'),exact:true});await showCanvas();const rotate=await page.locator('[data-text-handle=rotate]').boundingBox();await page.mouse.move(rotate.x+rotate.width/2,rotate.y+rotate.height/2);await page.mouse.down();await page.mouse.move(rotate.x+rotate.width/2+30,rotate.y+rotate.height/2+12,{steps:3});await page.mouse.up();await expect(rotation).not.toHaveValue('0');await undo.click();await expect(rotation).toHaveValue('0');await ready();
  // Escape rolls back a whole pointer gesture without discarding saved styles.
  await showCanvas();const second=await hit.boundingBox();await page.mouse.move(second.x+second.width/2,second.y+second.height/2);await page.mouse.down();await page.mouse.move(second.x+second.width/2+20,second.y+second.height/2+10);await page.keyboard.press('Escape');await page.mouse.up();await expect(x).toHaveValue(movedX);
  await page.getByRole('button',{name:new RegExp('^'+t('保存编辑','Save edits'))}).click();await expect(page.getByRole('button',{name:t('保存编辑','Save edits'),exact:true})).toBeEnabled();await ready();const frozen=await imageDigest(image);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(lang==='en')await expect(page.locator('.text-panel>summary')).toHaveText('Text & layers');await page.screenshot({path:info.outputPath('text-editor.png'),fullPage:true});
  await page.goto(route);await page.reload();await page.locator('.edit-records>div>button').filter({hasText:name}).first().click();await expect(content).toHaveValue('光影集 Photography\nÁg élan 👩🏽‍💻');await expect(size).toHaveValue('220');await expect(x).toHaveValue(movedX);await expect.poll(()=>imageDigest(image)).toBe(frozen);
  return {name,frozen,original};
}
