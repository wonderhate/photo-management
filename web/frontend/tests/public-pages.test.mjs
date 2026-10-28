import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPublicPages} from '../scripts/public-pages.mjs';

test('public introductions have real bilingual HTML, escaped selected content and only real sitemap URLs',async()=>{
  const out=await mkdtemp(join(tmpdir(),'lumina-public-pages-'));
  try{
    await mkdir(join(out,'assets'));await writeFile(join(out,'assets/PublicSite-test.css'),'');
    await writeFile(join(out,'index.html'),'<!doctype html><html lang="zh-CN"><head><title>Old</title></head><body><div id="root"></div><script src="/assets/app.js" type="module"></script></body></html>');
    const title='<script>unsafe</script>',photo={id:'sample',title,src:'/portfolio/images/sample.jpg',thumbnail:'/portfolio/images/thumb.jpg',width:20,height:10};
    await buildPublicPages(out,{title,intro:'Synthetic introduction',photos:[photo],featuredIds:['sample'],privatePath:'G:/synthetic-never-publish'});
    for(const path of ['index.html','en/index.html','about/index.html','en/about/index.html','lumina/index.html','en/lumina/index.html']){
      const text=await readFile(join(out,path),'utf8');
      assert.match(text,/<h1>/);assert.match(text,/rel="canonical"/);assert.match(text,/hreflang="en"/);assert.match(text,/property="og:image"/);
      assert(!text.includes('<script>unsafe</script>'));assert(!text.includes('G:/synthetic-never-publish'));
      assert(!text.includes('计算机专业'));
    }
    assert.match(await readFile(join(out,'index.html'),'utf8'),/&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.match(await readFile(join(out,'en/about/index.html'),'utf8'),/<html lang="en">/);
    assert.match(await readFile(join(out,'lumina/index.html'),'utf8'),/AI 辅助/);
    const sitemap=await readFile(join(out,'sitemap.xml'),'utf8'),urls=Array.from(sitemap.matchAll(/<loc>(.*?)<\/loc>/g),m=>m[1]);assert.equal(urls.length,7);assert(urls.every(url=>!url.includes('#')&&!url.includes('?')));
    assert.match(await readFile(join(out,'robots.txt'),'utf8'),/Sitemap: https:\/\/photomanagement.online\/sitemap.xml/);
  }finally{await rm(out,{recursive:true,force:true});}
});
