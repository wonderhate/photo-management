import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
try {
  await page.goto('http://127.0.0.1:8000',{waitUntil:'domcontentloaded'});
  await page.locator('.photo-card').first().waitFor();
  await page.evaluate(()=>{window.__galleryForCheck=document.querySelector('.gallery');window.scrollTo(0,1000)});
  await page.waitForTimeout(6500);
  const result=await page.evaluate(()=>({galleryPreserved:window.__galleryForCheck===document.querySelector('.gallery'),scrollY:window.scrollY,count:document.querySelector('.gallery-heading h1 span')?.textContent}));
  if(!result.galleryPreserved||result.scrollY<900)throw new Error(JSON.stringify(result));
  await page.screenshot({path:'verification/storage-live-refresh.png'});
  await fs.writeFile('verification/storage-refresh.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close()}
