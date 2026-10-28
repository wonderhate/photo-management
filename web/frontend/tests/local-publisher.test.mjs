import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {request as httpRequest,createServer} from 'node:http';
import {createPublisher,launchPublisher,projectId} from '../scripts/local-publisher.mjs';
import {emptyPortfolio} from '../src/browser/portfolio.ts';

const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK8M+iP//Z','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');

test('owner upload strips metadata, validates drafts, rejects cross-site writes and publishes only the fixed project',async()=>{
  const base=fileURLToPath(new URL('../../.test-artifacts/',import.meta.url));
  const work=await mkdtemp(base+'publisher-');let calls=0,builds=0,releaseWait;
  const wait=new Promise(r=>releaseWait=r);
  const publisher=await createPublisher({port:0,work,build:async()=>{builds++;return work+'/browser-static.zip';},verify:async()=>{},sdkFactory:token=>{
    assert.equal(token,'synthetic-owner-token');return {projects:{get:async input=>{assert.equal(input.projectId,projectId);return {projectId,name:'photomanagement'};}},deployments:{deploy:async input=>{calls++;assert.equal(input.projectId,projectId);assert.equal(input.env,'Production');assert.equal(input.wait,false);return {deploymentId:'synthetic-deployment'};},wait:async()=>{await wait;return {status:'Success'};}}};
  }});
  const url=new URL(publisher.url),origin=url.origin,secret=url.hash.slice(1);
  const request=(route,{method='POST',data={},headers={}}={})=>fetch(origin+'/author/api/'+route,{method,headers:{Authorization:'Bearer '+secret,Origin:origin,'Content-Type':Buffer.isBuffer(data)?'image/jpeg':'application/json',...headers},body:method==='GET'?undefined:Buffer.isBuffer(data)?data:JSON.stringify(data)});
  try{
    assert.equal(publisher.server.address().address,'127.0.0.1');
    assert.equal((await fetch(origin+'/author/api/state')).status,401);
    assert.equal((await request('draft',{headers:{Origin:'https://photomanagement.online'}})).status,403);
    assert.equal(await new Promise((yes,no)=>{const r=httpRequest(origin+'/author/api/state',{headers:{Host:'evil.example'}},res=>{res.resume();yes(res.statusCode);});r.on('error',no);r.end();}),403);
    assert.equal((await request('publish')).status,400);assert.equal(calls,0);
    assert.equal((await request('image',{data:jpeg.subarray(0,100)})).status,400);
    const metadata=Buffer.from('Exif\0\0GPS:synthetic-private-path');const length=Buffer.alloc(2);length.writeUInt16BE(metadata.length+2);
    const upload=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225]),length,metadata,jpeg.subarray(2)]),before=hash(upload);
    const image=await (await request('image',{data:upload})).json();assert.equal(image.width,3);assert.equal(image.height,2);assert.equal(hash(upload),before);
    const bytes=await readFile(work+'/content'+image.src);assert.ok(!bytes.includes(metadata));assert.equal(hash(bytes),image.id);
    const photo={...image,thumbnail:image.src,title:'合成照片',description:'',tags:[]};
    const draft={...emptyPortfolio,photos:[photo],featuredIds:[image.id],private_path:'private'};
    assert.equal((await request('draft',{data:{...draft,photos:[{...photo,src:'/portfolio/images/../../private.jpg'}]}})).status,400);
    assert.equal((await request('draft',{data:{...draft,photos:[{...photo,width:4}]}})).status,400);
    assert.equal((await request('draft',{data:draft})).status,200);
    const state=await (await request('state',{method:'GET'})).json();assert.equal(state.catalog.photos.length,1);assert.ok(!JSON.stringify(state).includes('private_path'));
    const previousModulePath=process.env.PSModulePath;
    try{
      // Reproduce the PowerShell 7 module path inherited by Windows PowerShell.
      if(process.platform==='win32')process.env.PSModulePath='C:/Program Files/PowerShell/7/Modules';
      assert.equal((await request('credential',{data:{token:'synthetic-owner-token',remember:process.platform==='win32'}})).status,200);
      if(process.platform==='win32'){
        const encrypted=await readFile(work+'/edgeone-token.dpapi','utf8');assert.ok(!encrypted.includes('synthetic-owner-token'));
        const reopened=await createPublisher({port:0,work});
        try{const u=new URL(reopened.url);const state=await(await fetch(u.origin+'/author/api/state',{headers:{Authorization:'Bearer '+u.hash.slice(1)}})).json();assert.equal(state.credential,true);}finally{await new Promise(r=>reopened.server.close(r));}
      }
    }finally{if(previousModulePath===undefined)delete process.env.PSModulePath;else process.env.PSModulePath=previousModulePath;}
    assert.equal((await request('publish')).status,202);
    for(let i=0;i<100&&!calls;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal((await request('draft',{data:draft})).status,409);assert.equal(calls,1);assert.equal(builds,1);
    releaseWait();let after;
    for(let i=0;i<100;i++){after=await (await request('state',{method:'GET'})).json();if(!after.job.busy)break;await new Promise(r=>setTimeout(r,10));}
    assert.match(after.job.message,/正式网站已更新/);assert.ok(!JSON.stringify(after).includes('synthetic-owner-token'));
    assert.equal((await fetch(origin+'/portfolio/manifest.json',{method:'PUT',body:'bad'})).status,405);
    assert.equal((await fetch(origin+'/.local-notes/publisher/edgeone-token.dpapi')).status,404);
    assert.equal((await request('credential',{data:{token:''}})).status,200);await assert.rejects(access(work+'/edgeone-token.dpapi'));
  }finally{releaseWait();await new Promise(r=>publisher.server.close(r));}
});

test('credential diagnostics name the failure stage without exposing request secrets',async()=>{
  const base=fileURLToPath(new URL('../../.test-artifacts/',import.meta.url));
  const work=await mkdtemp(base+'publisher-errors-');
  const secretToken='synthetic-must-never-appear';
  const p=await createPublisher({port:0,work,sdkFactory:()=>({projects:{get:async()=>{throw new TypeError('Private details: '+secretToken);}}})});
  try{
    const u=new URL(p.url);const r=await fetch(u.origin+'/author/api/credential',{method:'POST',headers:{Origin:u.origin,Authorization:'Bearer '+u.hash.slice(1),'Content-Type':'application/json'},body:JSON.stringify({token:secretToken})});
    assert.equal(r.status,400);const text=await r.text();assert.match(text,/project-query \/ TypeError/);assert.ok(!text.includes(secretToken));
    const state=await (await fetch(u.origin+'/author/api/state',{headers:{Authorization:'Bearer '+u.hash.slice(1)}})).json();assert.equal(state.lastIssue.phase,'project-query');assert.equal(state.lastIssue.type,'TypeError');assert.equal(state.credential,false);assert.ok(!JSON.stringify(state).includes(secretToken));
  }finally{await new Promise(r=>p.server.close(r));}
});

test('repeated launch reuses the authenticated owner service and recovers stale records without stopping other services',async()=>{
  const base=fileURLToPath(new URL('../../.test-artifacts/',import.meta.url));const work=await mkdtemp(base+'publisher-launch-');
  const runtime=work+'/instance.json';const first=await launchPublisher({port:0,work,runtime});
  try{
    const again=await launchPublisher({port:0,work,runtime});assert.equal(again.reused,true);assert.equal(again.url,first.url);assert.equal(again.server,null);
  }finally{await new Promise(r=>first.server.close(r));}
  const reopened=await launchPublisher({port:0,work,runtime});assert.equal(reopened.reused,false);assert.notEqual(reopened.url,first.url);await new Promise(r=>reopened.server.close(r));
  const foreign=createServer((req,res)=>res.end('unrelated service'));await new Promise(r=>foreign.listen(0,'127.0.0.1',r));
  try{
    const port=foreign.address().port;await assert.rejects(launchPublisher({port,work,runtime}),/已被其他服务占用/);assert.equal(await(await fetch('http://127.0.0.1:'+port)).text(),'unrelated service');
  }finally{await new Promise(r=>foreign.close(r));}
});
