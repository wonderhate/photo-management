// One-time asset preparation. Runtime rendering uses only the bundled PNGs and Pillow.
const {chromium}=require('@playwright/test');
const fs=require('fs'),path=require('path');
const folder=path.resolve(__dirname,'../../backend/app/assets/brand_logos');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:2});
    for(const filename of fs.readdirSync(folder).filter(f=>f.endsWith('.svg'))){
      let svg=fs.readFileSync(path.join(folder,filename),'utf8');
      if(filename==='sony.svg')svg=svg.replace('fill:#fff','fill:#000'); // Black wordmark on the white information bar.
      if(filename==='canon.svg')svg=svg.replace('width="233.74"','width="126"').replace('viewBox="0 0 233.74 26"','viewBox="0 0 126 26"'); // Canon wordmark without the website's "Global" label.
      const source='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
      await page.setContent('<style>html,body{margin:0;background:transparent}img{display:block;max-width:1024px;max-height:1024px}</style><img alt="brand" src="'+source+'">');
      await page.locator('img').evaluate(async image=>{await image.decode();if(!image.naturalWidth)throw new Error('Invalid SVG')});
      await page.locator('img').screenshot({path:path.join(folder,filename.replace('.svg','.png')),omitBackground:true});
      console.log(filename+' -> PNG');
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
