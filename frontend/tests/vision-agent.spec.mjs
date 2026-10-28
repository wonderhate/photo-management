import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function appCall(page,path,method='GET',data){return page.evaluate(async({path,method,data})=>{
 const health=await fetch('/api/health'),headers={'X-PhotoCollection-Session':health.headers.get('X-PhotoCollection-Session'),'X-PhotoCollection-Library':health.headers.get('X-PhotoCollection-Library'),'Content-Type':'application/json'};
 const r=await fetch('/api'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});if(!r.ok)throw new Error(await r.text());return r.json();
},{path,method,data});}
for(const textSize of [1,1000])test(`local Agent approval runs shared editor once and retains original bytes at size ${textSize}`,async({page,request})=>{
 await page.addInitScript(()=>{localStorage.setItem('onboarded','1');localStorage.setItem('lang','en');});
 const health=await(await request.get('/api/health')).json();expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
 const path=join(health.data_dir,'agent-editor-source.png');execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image,ImageDraw; import sys; im=Image.new('RGB',(640,480),'#557788');ImageDraw.Draw(im).ellipse((200,100,420,400),fill='#ddbb66');im.save(sys.argv[1])",path]);
 const before=hash(path),job=await(await request.post('/api/photos/import',{data:{paths:[path]}})).json();await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
 const photo=(await(await request.get('/api/photos?search=agent-editor-source.png&count_mode=file')).json()).photos[0];
 await page.goto('/?page=settings');await expect(page.getByRole('heading',{name:'Local Agent / MCP'})).toBeVisible();
 const state=await appCall(page,'/agent/settings','PUT',{enabled:true,scopes:['read','write']});
 try{
  const headers={Authorization:'Bearer '+state.token,Accept:'application/json, text/event-stream'};
  const init=await request.post('/mcp',{headers,data:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'fixture',version:'1'}}}});expect(init.ok()).toBe(true);
  headers['Mcp-Session-Id']=init.headers()['mcp-session-id'];headers['MCP-Protocol-Version']='2025-06-18';await request.post('/mcp',{headers,data:{jsonrpc:'2.0',method:'notifications/initialized'}});
  const response=await(await request.post('/mcp',{headers,data:{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'add_text',arguments:{catalog_id:state.catalog_id,photo_ids:[photo.id],text:'Approved locally',size:textSize}}}})).json();expect(response.result.isError).toBe(false);const task=JSON.parse(response.result.content[0].text);
  await page.getByRole('button',{name:'Activity center',exact:true}).click();await page.locator('.activity-list [data-task-id="'+task.job_id+'"]').click();await expect(page.getByText('Add text layers',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Approve this request',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.bringToFront();
  await expect.poll(async()=>(await(await request.get('/api/jobs/'+task.job_id)).json()).status,{timeout:30000}).toBe('completed');
  const done=await(await request.get('/api/jobs/'+task.job_id)).json();expect(done.agent_result.documents).toHaveLength(1);const edit=await(await request.get('/api/editor/edits/'+done.agent_result.documents[0].id)).json();expect(edit.recipe.layer_stack.version).toBe(2);expect(edit.recipe.layer_stack.layers[0].text).toBe('Approved locally');expect(edit.recipe.layer_stack.layers[0].size).toBe(textSize);expect(hash(path)).toBe(before);
 }finally{await appCall(page,'/agent/settings','PUT',{enabled:false,scopes:['read']});}
});
