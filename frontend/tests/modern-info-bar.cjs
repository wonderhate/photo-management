const {chromium,expect}=require('@playwright/test');
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'../..'),base=process.env.PHOTO_TEST_URL||'http://127.0.0.1:8011';
const sample=path.join(root,'.test-artifacts','modern-info-photo.jpg');
fs.mkdirSync(path.dirname(sample),{recursive:true});
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
from PIL import Image,TiffImagePlugin
import sqlite3,sys
from pathlib import Path
with sqlite3.connect('file:G:/修后图/library.db?mode=ro',uri=True) as db:
    source=db.execute("select file_path from photos where camera_make like '%NIKON%' and is_raw=0 limit 1").fetchone()
image=Image.open(source[0]).convert('RGB') if source and Path(source[0]).is_file() else Image.new('RGB',(1920,1280),(24,38,52))
image.thumbnail((1920,1920))
exif=Image.Exif()
for k,v in {271:'Nikon',272:'NIKON Z 7_2',37386:TiffImagePlugin.IFDRational(61),33437:TiffImagePlugin.IFDRational(4),33434:TiffImagePlugin.IFDRational(1,250),34855:1100,36867:'2020:01:04 14:08:11'}.items():exif[k]=v
image.save(sys.argv[1],exif=exif)
`,sample]);
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    let context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const health=await(await context.request.get(base+'/api/health')).json();
    if(!path.resolve(health.data_dir).startsWith(path.join(root,'.test-artifacts')+path.sep))throw new Error('Test library required');
    const job=await(await context.request.post(base+'/api/photos/import',{data:{paths:[sample]}})).json();
    await expect.poll(async()=>(await(await context.request.get(base+'/api/jobs/'+job.id)).json()).status).toBe('completed');
    const listing=await(await context.request.get(base+'/api/photos')).json(),photo=listing.photos.find(p=>p.file_name===path.basename(sample));
    await page.goto(base+'/watermark/workshop?photo='+photo.id);
    await expect(page.getByRole('button',{name:'现代信息条相框',exact:true})).toBeVisible();
    await expect(page.getByLabel('显示品牌 logo',{exact:true})).toBeChecked();
    await expect(page.getByLabel('拍摄时间',{exact:true})).toBeChecked();
    await expect(page.getByRole('img',{name:'水印实时预览'})).toBeVisible();
    await page.screenshot({path:path.join(root,'.test-artifacts','modern-info-workshop.png'),fullPage:true});
    let response=await context.request.post(base+'/api/watermark/preview',{data:{photo_id:photo.id,options:{long_edge:0}}});
    fs.writeFileSync(path.join(root,'.test-artifacts','modern-info-preview.jpg'),await response.body());
    await page.getByLabel('显示品牌 logo',{exact:true}).uncheck();
    await page.getByLabel('ISO',{exact:true}).uncheck();
    await page.getByLabel('快门',{exact:true}).uncheck();
    await page.getByLabel('拍摄时间',{exact:true}).uncheck();
    await page.getByLabel('水印作品名称').fill('现代信息条验收');
    await page.getByRole('button',{name:'保存到水印图库',exact:true}).click();
    await expect(page).toHaveURL(/draft=/);const id=new URL(page.url()).searchParams.get('draft');
    await context.close();context=await browser.newContext({viewport:{width:1500,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/watermark/workshop?draft='+id);
    for(const label of ['显示品牌 logo','ISO','快门','拍摄时间'])await expect(page.getByLabel(label,{exact:true})).not.toBeChecked();
    await page.getByLabel('显示品牌 logo',{exact:true}).check();
    await expect.poll(async()=>(await(await context.request.get(base+'/api/watermark/drafts/'+id)).json()).settings_json.show_brand_logo).toBe(true);
    await page.getByRole('button',{name:'标记为待导出',exact:true}).click();
    await page.getByRole('button',{name:'水印图库',exact:true}).click();
    await expect(page.locator('.draft-card').filter({hasText:'现代信息条验收'})).toBeVisible();
    response=await context.request.post(base+'/api/watermark/drafts/'+id+'/export',{data:{format:'png',long_edge:0}});
    if(!response.ok())throw new Error(await response.text());
    const output=await response.json();fs.copyFileSync(output.path,path.join(root,'.test-artifacts','modern-info-export.png'));
    await context.request.delete(base+'/api/watermark/drafts/'+id);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,verified:['default modern style','logo and date default on','all toggles restore after browser close','logo autosave','ready gallery','draft export'],output:output.path}));
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
