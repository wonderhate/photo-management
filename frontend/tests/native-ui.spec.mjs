import {test,expect} from '@playwright/test';
const connectPage=new URL('../../android/app/src/main/assets/index.html',import.meta.url).href;

for(const width of [360,390,430])test(`Android connection layout and bilingual pairing ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(()=>{
    localStorage.setItem('lang','zh');window.requests=[];
    window.Connect={setLanguage:lang=>window.requests.push({lang}),connect:(address,code)=>window.requests.push({address,code}),resume:address=>window.requests.push({resume:address})};
  });
  await page.goto(connectPage);
  await expect(page.locator('footer')).toHaveText('收集光，收藏爱');
  await expect(page.locator('html')).toHaveCSS('background-color','rgb(247, 245, 240)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('android-connect-zh.png'),fullPage:true});
  await page.getByRole('button',{name:'切换为英文',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  expect(await page.locator('body').innerText()).not.toMatch(/[\u3400-\u9fff]/u);
  await page.locator('#pair').click();
  await expect(page.locator('#error')).toHaveText('Enter the 8-digit pairing code');
  expect(await page.evaluate(()=>window.requests.some(r=>r.code))).toBe(false);
  await page.locator('#address').fill('http://192.168.1.20:8000');
  await page.locator('#code').fill('00123456');await page.locator('#pair').click();
  expect(await page.evaluate(()=>window.requests.at(-1))).toEqual({address:'http://192.168.1.20:8000',code:'00123456'});
  await expect(page.locator('#language')).toBeDisabled();
  await page.evaluate(()=>window.connectionDone('电脑地址或配对码无效'));
  await expect(page.locator('#error')).toHaveText('Invalid computer address or pairing code');
  await page.screenshot({path:info.outputPath('android-connect-en.png'),fullPage:true});
  await page.locator('#resume').click();
  expect(await page.evaluate(()=>window.requests.at(-1))).toEqual({resume:'http://192.168.1.20:8000'});
  await page.evaluate(()=>window.connectionDone(''));
  await page.getByRole('button',{name:'Switch to Chinese',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
});
