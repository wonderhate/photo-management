import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';

test('development pages start under CSP with React refresh and local WebSocket access',async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  // Other tests start Vite with another mode. A shared optimizer cache can turn
  // valid module URLs into 504 Outdated Optimize Dep during parallel runs.
  const artifactRoot=fileURLToPath(new URL('../../.test-artifacts/',import.meta.url));
  await mkdir(artifactRoot,{recursive:true});const cacheDir=await mkdtemp(join(artifactRoot,'dev-preview-vite-'));
  const server=await createServer({root,cacheDir,mode:'showcase',server:{host:'127.0.0.1',port:5185,strictPort:true}});
  t.after(async()=>{await server.close();assert.equal(dirname(cacheDir),artifactRoot.replace(/[\\/]$/,''));await rm(cacheDir,{recursive:true,force:true});});await server.listen();
  const browser=await chromium.launch({channel:process.env.CI?undefined:'chrome',headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  for(const [path,selector] of [['/windows.html','.download-packages'],['/','.hero'],['/?local=1','.browser-start']]){
    const response=await page.goto('http://127.0.0.1:5185'+path);
    assert.equal(response.status(),200);try{await expect(page.locator(selector)).toBeVisible();}catch(error){t.diagnostic(JSON.stringify({path,errors,body:(await page.locator('body').innerText()).slice(0,1000)}));throw error;}
    const csp=response.headers()['content-security-policy'];
    const nonce=await page.locator('meta[property="csp-nonce"]').evaluate(e=>e.nonce);
    assert.ok(nonce);assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`));
    assert.ok(csp.includes('ws://127.0.0.1:5185'));assert.ok(csp.includes('ws://127.0.0.1:9000'));
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
  }
  assert.deepEqual(errors,[]);
});
