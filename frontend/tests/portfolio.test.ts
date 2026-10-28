import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emptyPortfolio,validatePortfolio} from '../src/browser/portfolio.ts';

test('public manifest validates relationships and strips private metadata',()=>{
  const p={id:'one',title:'光',description:'<script>text only</script>',src:'/portfolio/images/photo.jpg',thumbnail:'/portfolio/images/thumb.jpg',width:1200,height:800,tags:['山'],file_path:'C:/private.jpg',gps_latitude:42};
  const s={...emptyPortfolio,photos:[p],featuredIds:['one'],albums:[{id:'album',title:'旅途',description:'',photoIds:['one']}],sources:['private']};
  const clean=validatePortfolio(s);assert.equal(clean.photos[0].title,'光');assert.ok(!JSON.stringify(clean).includes('private'));assert.ok(!JSON.stringify(clean).includes('gps_'));
  for(const path of ['https://example.org/photo.jpg','//host/photo.jpg','/portfolio/images/../secret.jpg','/portfolio/images/%2e%2e.jpg','data:image/jpeg;base64,xxx'])assert.throws(()=>validatePortfolio({...s,photos:[{...p,src:path}]}));
  for(const patch of [{photos:[p,p]},{featuredIds:['missing']},{featuredIds:['one','one']},{photos:[{...p,width:Infinity}]},{albums:[{id:'album',title:'x',description:'',photoIds:['missing']}]},{version:2}])assert.throws(()=>validatePortfolio({...s,...patch}));
  assert.deepEqual(validatePortfolio(emptyPortfolio),emptyPortfolio);
});

test('public build rejects external resources before touching an existing build',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),input=root+'.test-artifacts/public-invalid/';mkdirSync(input+'portfolio',{recursive:true});
  writeFileSync(input+'portfolio/manifest.json',JSON.stringify({...emptyPortfolio,photos:[{id:'bad',title:'',description:'',src:'https://example.com/private.jpg',thumbnail:'/portfolio/images/thumb.jpg',width:1,height:1,tags:[]}]}));
  const output=root+'frontend/dist-showcase/index.html',before=existsSync(output)?readFileSync(output):null;
  const result=spawnSync(process.execPath,['--experimental-strip-types',root+'frontend/scripts/build-showcase.mjs','--content',input],{cwd:root,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid public portfolio/);if(before)assert.deepEqual(readFileSync(output),before);
});
