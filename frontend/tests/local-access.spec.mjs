import {test,expect} from './fixtures/native-runtime.mjs';

for(const lang of ['zh','en'])test(`settings contain local controls without phone pairing ${lang}`,async({page,request})=>{
  await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1')},lang);
  const obsolete=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/remote/'))obsolete.push(request.url())});
  await page.goto('/?page=settings');
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(page.locator('.shortcuts-edit')).toBeVisible();
  await expect(page.locator('.remote-settings')).toHaveCount(0);
  await expect(page.getByText(/八位配对码|手机远程访问|Phone Remote Access|Eight-Digit Pairing Code/)).toHaveCount(0);
  expect((await request.get('/api/remote/settings')).status()).toBe(404);
  expect((await request.get('/api/files/browse')).status()).toBe(404);
  expect(obsolete).toEqual([]);
});
