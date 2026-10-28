import {expect} from '@playwright/test';

export async function exercisePhotoActivation(page,{id,name,layout,screenshot}){
  await page.getByRole('button',{name:'Grid Display Settings',exact:true}).click();
  await page.getByRole('combobox',{name:'Gallery layout',exact:true}).selectOption(layout);
  await page.getByRole('button',{name:'Grid Display Settings',exact:true}).click();
  const scroller=page.locator(layout==='waterfall'?'.waterfall-scroller':'.virtual-gallery>div');
  if(screenshot){await page.screenshot({path:screenshot,fullPage:true});await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})}
  await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight});
  const image=page.locator(`.photo-card[data-photo-id="${id}"] .photo-image`);
  await expect(image).toBeVisible();await image.scrollIntoViewIfNeeded();
  // Waiting for scrolling to settle would hide the interaction failure.
  await scroller.evaluate(async el=>{el.scrollTop=Math.max(0,el.scrollTop-1);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)});
  const before=await image.evaluate(el=>{
    const gallery=el.closest('.virtual-gallery'),outer=gallery.querySelector('.waterfall-scroller')||gallery.firstElementChild;
    const a=el.getBoundingClientRect(),b=outer.getBoundingClientRect();
    const left=Math.max(a.left,b.left,0),right=Math.min(a.right,b.right,innerWidth),top=Math.max(a.top,b.top,0),bottom=Math.min(a.bottom,b.bottom,innerHeight);
    const x=(left+right)/2,y=(top+bottom)/2,hit=document.elementFromPoint(x,y);window.__activationOrigin=el;
    return {x,y,top:a.top,visible:bottom>top&&right>left,interactive:el===hit||el.contains(hit),pointerEvents:getComputedStyle(el).pointerEvents,hit:hit?.tagName};
  });
  expect(before.visible,JSON.stringify(before)).toBe(true);expect(before.interactive,JSON.stringify(before)).toBe(true);
  await page.mouse.click(before.x,before.y);
  const selected=page.locator(`.photo-card[data-photo-id="${id}"] .select-box`);await expect(selected).toHaveAttribute('aria-pressed','true');
  expect(await image.evaluate(el=>el===window.__activationOrigin)).toBe(true);
  expect(Math.abs((await image.boundingBox()).y-before.top)).toBeLessThan(1);
  // Second physical press at the same point, without another locator scroll or retry.
  await page.mouse.down({clickCount:2});await page.mouse.up({clickCount:2});
  await expect(page.locator('.photo-viewer .viewer-caption b')).toHaveText(name);
  await page.keyboard.press('Escape');await expect(selected).toHaveAttribute('aria-pressed','false');
}
