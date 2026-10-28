// This owner service is never part of the Vite output or deployed website.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rename,stat,realpath,unlink,access} from 'node:fs/promises';
import {resolve,dirname,sep,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {Makers} from '@edgeone/makers-sdk';
import {validatePortfolio,emptyPortfolio} from '../src/browser/portfolio.ts';

export const projectId='makers-o7xx3x5jqy77',projectName='photomanagement',site='https://photomanagement.online';
const root=fileURLToPath(new URL('../../',import.meta.url));
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin'};
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
async function exists(p){try{await access(p);return true;}catch{return false;}}
async function atomic(path,data,options){await mkdir(dirname(path),{recursive:true});const temp=path+'.tmp';await writeFile(temp,data,options);await rename(temp,path);}
function command(executable,args,{input,env}={}){
  return new Promise((yes,no)=>{const child=spawn(executable,args,{cwd:root,windowsHide:true,env:env||process.env,stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',b=>{out=(out+b).slice(-16000);});child.stderr.resume();child.on('error',()=>no(new Error('本机命令无法启动，请检查 Node.js / Python。')));child.on('close',code=>code===0?yes(out.trim()):no(new Error('本机构建或加密操作失败，请在项目中运行 npm test 检查环境。')));child.stdin.end(input||'');});
}
async function dpapi(value,decrypt=false){
  if(process.platform!=='win32')fail('持久保存发布凭据仅支持当前 Windows 用户；其他系统可仅在本次会话使用。');
  // Secret goes through stdin, never command-line arguments or logs.
  const code=decrypt?"$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}":"$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force;[Console]::Write((ConvertFrom-SecureString $s))";
  // Windows PowerShell must load its own Security module; inherited PowerShell 7
  // PSModulePath can otherwise select an incompatible module and break DPAPI.
  const setup="$ErrorActionPreference='Stop';Import-Module ($PSHOME + '/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop;";
  return command('powershell.exe',['-NoProfile','-NonInteractive','-Command',setup+code],{input:value});
}
// Reject incomplete JPEGs and remove EXIF, XMP, IPTC and comments, including after scans.
export function publicJPEG(data){
  if(data.length<4||data.length>25*1024*1024||data[0]!==255||data[1]!==216)fail('请上传有效 JPEG 展示副本（不超过 25 MiB）。');
  const parts=[data.subarray(0,2)];let pos=2,width=0,height=0,scanned=false,ended=false;
  while(pos<data.length){
    const start=pos;if(data[pos++]!==255)fail('JPEG 数据损坏。');while(data[pos]===255)pos++;const marker=data[pos++];
    if(marker===217){parts.push(Buffer.from([255,217]));ended=true;break;}
    if(marker===216||marker===0||marker===1||marker>=208&&marker<=215||pos+2>data.length)fail('JPEG 标记损坏。');
    const length=data.readUInt16BE(pos);if(length<2||pos+length>data.length)fail('JPEG 数据不完整。');
    const end=pos+length;
    if([192,193,194].includes(marker)){if(length<8)fail('JPEG 尺寸损坏。');height=data.readUInt16BE(pos+3);width=data.readUInt16BE(pos+5);}
    if(!(marker>=225&&marker<=239||marker===254))parts.push(data.subarray(start,end));
    pos=end;
    if(marker===218){scanned=true;const scan=pos;while(pos<data.length){if(data[pos]!==255){pos++;continue;}let next=pos+1;while(data[next]===255)next++;if(data[next]===0||data[next]>=208&&data[next]<=215){pos=next+1;continue;}break;}parts.push(data.subarray(scan,pos));}
  }
  if(!ended||!scanned||width<1||height<1||width>8192||height>8192)fail('JPEG 尺寸或数据无效。');
  return {data:Buffer.concat(parts),width,height};
}
async function body(req,limit){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>limit)fail('上传内容过大。',413);chunks.push(b);}return Buffer.concat(chunks);}

export async function createPublisher({port=4178,session=randomBytes(32).toString('hex'),work=resolve(root,'.local-notes/publisher'),sdkFactory=token=>new Makers({token,region:'china',retries:0,timeout:45}),build,verify}={}){
  if(!/^[a-f0-9]{64}$/.test(session))throw new Error('Invalid owner session.');
  const secret=session;
  const source=resolve(work,'content'),manifest=resolve(source,'portfolio/manifest.json'),credentials=resolve(work,'edgeone-token.dpapi'),out=resolve(root,'frontend/dist-showcase');
  const python=await exists(resolve(root,'.venv/Scripts/python.exe'))?resolve(root,'.venv/Scripts/python.exe'):'python';
  let token=process.env.EDGEONE_API_TOKEN||'',job=null,release=null,mutating=false,lastIssue=null,credentialWarning='';
  if(!token&&await exists(credentials))try{token=await dpapi(await readFile(credentials,'utf8'),true);}catch{/* Moved or different-user credentials need re-entry. */}
  await mkdir(resolve(source,'portfolio/images'),{recursive:true});
  async function catalog(){try{return validatePortfolio(JSON.parse(await readFile(manifest,'utf8')));}catch(e){if(e.code!=='ENOENT')fail('本机草稿损坏；请保留文件并从历史发布包恢复。');return structuredClone(emptyPortfolio);}}
  async function checkCatalog(value){const clean=validatePortfolio(value);for(const p of clean.photos){for(const url of [p.src,p.thumbnail]){const filename=resolve(source,'.'+url);if(!(await stat(filename)).isFile()||await realpath(filename)!==filename)fail('展示副本无效。');const image=publicJPEG(await readFile(filename));if(hash(image.data)!==url.split('/').at(-1).slice(0,-4))fail('展示副本校验失败。');if(url===p.src&&(image.width!==p.width||image.height!==p.height))fail('展示照片尺寸不匹配。');}}return clean;}
  async function owner(client){const project=await client.projects.get({projectId});if(project.projectId!==projectId||project.name!==projectName)fail('Token 对应的项目与正式网站不匹配，已停止。');return client;}
  async function buildRelease(){
    if(build)return build(await catalog()); // Isolated synthetic integration checks.
    await command(process.execPath,['--experimental-strip-types',resolve(root,'frontend/scripts/build-showcase.mjs'),'--content',source],{env:{...process.env,VITE_ART_RELAY_URL:'wss://ai.photomanagement.online/cloud-art'}});
    return command(python,[resolve(root,'frontend/scripts/package-showcase.py')]);
  }
  async function verifyLive(){
    if(verify)return verify();const expected=hash(await readFile(resolve(out,'index.html')));
    for(let i=0;i<18;i++){try{const r=await fetch(site+'/?release='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});if(r.ok&&hash(Buffer.from(await r.arrayBuffer()))===expected)return;}catch{}await new Promise(r=>setTimeout(r,5000));}
    fail('平台已完成部署，但正式域名内容尚未核对一致。请检查控制台和缓存；不要重复提交。');
  }
  async function execute(publish){
    let deployment;
    try{
      const client=publish?await owner(sdkFactory(token)):null;
      job.message='正在构建并校验公开网站…';
      await atomic(manifest,JSON.stringify(await checkCatalog(await catalog()),null,2));
      release=await buildRelease();job.message='本机预览和网站 ZIP 已就绪。';
      if(client){
        job.message='正在上传到现有 EdgeOne 项目…';
        deployment=await client.deployments.deploy({projectId,artifact:{archive:release},env:'Production',wait:false});
        job.deploymentId=deployment.deploymentId;
        await atomic(resolve(work,'last-deployment.json'),JSON.stringify({deploymentId:deployment.deploymentId,projectId,release,submittedAt:new Date().toISOString()},null,2));
        const result=await client.deployments.wait({projectId,deploymentId:deployment.deploymentId,timeout:900,pollInterval:5,onStatusChange:e=>{job.message='EdgeOne 部署状态：'+e.deployment.status;}});
        if(result.status!=='Success')fail('EdgeOne 部署未成功：'+result.status+'。旧发布包仍保留。');
        job.message='部署完成，正在核对正式域名…';await verifyLive();job.message='正式网站已更新并核对：https://photomanagement.online/';
        await atomic(resolve(work,'last-success.json'),JSON.stringify({deploymentId:deployment.deploymentId,projectId,release,verifiedAt:new Date().toISOString()},null,2));
      }
    }catch(e){const detail=e.name+(e.message?': '+String(e.message).slice(0,160):'');job.error=e.status?e.message:deployment?'本次等待或核对失败，云端可能仍在部署。请先检查控制台，勿重复发布。':'操作失败（'+detail+'）。请核对 Token、网络和项目权限；本机草稿保留。';job.message='本次操作未完成。';}
    finally{job.busy=false;}
  }
  const server=createServer(async(req,res)=>{
    let mutation=false,phase='request';
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(data));};
    try{
      const host='127.0.0.1:'+server.address().port;
      if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host||req.headers['sec-fetch-site']==='cross-site')fail('仅接受本机作者页面的请求。',403);
      const url=new URL(req.url,'http://'+host),name=decodeURIComponent(url.pathname);
      if(name.startsWith('/author/api/')){
        const auth=Buffer.from(req.headers.authorization?.replace(/^Bearer /,'')||'');const expected=Buffer.from(secret);
        if(auth.length!==expected.length||!timingSafeEqual(auth,expected))fail('作者会话无效，请使用启动时的完整地址。',401);
        const action=name.slice('/author/api/'.length);
        if(req.method==='GET'&&action==='instance'){json(200,{publisher:'lumina-local-publisher-v1',root:hash(root),projectId});return;}
        if(req.method==='GET'&&action==='state'){json(200,{catalog:await catalog(),credential:!!token,credentialWarning,canRemember:process.platform==='win32',project:projectName,job,release:!!release,lastIssue});return;}
        if(req.method==='GET'&&action==='download'){if(!release)fail('请先生成网站包。',404);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="Lumina-website.zip"',...headers});res.end(await readFile(release));return;}
        if(req.method==='GET'&&action.startsWith('image/')){const file=action.slice(6);if(!/^[a-f0-9]{64}\.jpg$/.test(file))fail('照片不存在。',404);res.writeHead(200,{'Content-Type':'image/jpeg',...headers});res.end(await readFile(resolve(source,'portfolio/images',file)));return;}
        if(req.method!=='POST')fail('方法不允许。',405);
        if(req.headers.origin!=='http://'+host)fail('缺少本机来源。',403);
        if(job?.busy||mutating)fail('正在保存、构建或发布，请等待完成。',409);
        mutating=true;mutation=true;
        if(action==='image'){
          if(req.headers['content-type']!=='image/jpeg')fail('只接受 JPEG 展示副本。');
          const image=publicJPEG(await body(req,25*1024*1024)),id=hash(image.data);await atomic(resolve(source,'portfolio/images',id+'.jpg'),image.data);json(200,{id,src:'/portfolio/images/'+id+'.jpg',width:image.width,height:image.height});return;
        }
        if(req.headers['content-type']!=='application/json')fail('只接受 JSON 请求。',415);
        const value=JSON.parse((await body(req,8*1024*1024)).toString('utf8'));
        if(action==='draft'){
          const clean=await checkCatalog(value);if(await exists(manifest))await atomic(manifest+'.previous',await readFile(manifest));await atomic(manifest,JSON.stringify(clean,null,2));release=null;job=null;json(200,{saved:true});return;
        }
        if(action==='credential'){
          phase='token-format';
          if(typeof value.token!=='string'||value.token.length>4096||/[^\x21-\x7e]/.test(value.token))fail('Token 含空格、换行或非英文字符。请复制创建结果中的完整 Token，不要复制说明文字。');
          phase='project-query';
          if(value.token)await owner(sdkFactory(value.token));
          phase='credential-encryption';
          token=value.token;credentialWarning='';
          try{
            if(token&&value.remember)await atomic(credentials,await dpapi(token));else await unlink(credentials).catch(e=>{if(e.code!=='ENOENT')throw e;});
          }catch{
            credentialWarning='Token 和项目权限有效，本次会话可用；本机加密保存失败，重启发布服务后需重新填写。';
            await unlink(credentials).catch(()=>{});
          }
          lastIssue=null;json(200,{configured:!!token,warning:credentialWarning});return;
        }
        if(action==='build'||action==='publish'){
          if(action==='publish'&&!token)fail('请先在下方配置 EdgeOne Makers 发布 Token。');
          await checkCatalog(await catalog());job={busy:true,message:'正在准备…'};json(202,{started:true});void execute(action==='publish');return;
        }
        fail('接口不存在。',404);
      }
      if(!['GET','HEAD'].includes(req.method))fail('展示页不接受修改。',405);
      let file,type;
      if(['/author/','/author/index.html','/author/app.js','/author/style.css'].includes(name)){
        file=resolve(root,'frontend/author',name==='/author/'?'index.html':name.split('/').at(-1));type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      }else{
        file=resolve(out,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(out+sep)||await realpath(file)!==file)fail('文件不存在。',404);
        if((await stat(file)).isDirectory()){file=resolve(file,'index.html');if(await realpath(file)!==file)fail('文件不存在。',404);}
        type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.jpg':'image/jpeg','.png':'image/png','.ttf':'font/ttf','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'})[extname(file)]||'application/octet-stream';
      }
      const data=await readFile(file);res.writeHead(200,{'Content-Type':type+(/^(text\/|application\/json)/.test(type)?'; charset=utf-8':''),...headers});res.end(req.method==='HEAD'?undefined:data);
    }catch(e){
      const code=typeof e.code==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(e.code)?e.code:'';
      const kind=['AuthError','NotFoundError','ValidationError','TimeoutError','MakersError','UploadError'].includes(e.name)?e.name:'';
      const type=/^[A-Za-z]{1,40}$/.test(e.name)?e.name:'Error';
      lastIssue={phase,type,code,at:new Date().toISOString()};
      console.error('Owner request failed:',JSON.stringify(lastIssue));
      const message=e.status?e.message:e.code==='ENOENT'?'文件不存在。':kind?`腾讯云校验未通过：${kind}${code?' / '+code:''}。请检查 Token 所属账户和控制台项目。`:`操作未完成（${phase} / ${type}${code?' / '+code:''}）。本机草稿保留，请将此错误提示反馈给开发者。`;
      if(!res.headersSent)json(e.status||(e.code==='ENOENT'?404:400),{error:message});else res.end();
    }finally{if(mutation)mutating=false;}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  return {server,url:'http://127.0.0.1:'+server.address().port+'/author/#'+secret};
}

export async function launchPublisher({port=4178,runtime=resolve(root,'.runtime/publisher-instance.json'),...options}={}){
  async function existing(){
    try{
      const record=JSON.parse(await readFile(runtime,'utf8')),url=new URL(record.url);
      if(record.root!==hash(root)||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/author/'||url.search||!/^#[a-f0-9]{64}$/.test(url.hash)||port!==0&&url.port!==String(port))return null;
      const r=await fetch(url.origin+'/author/api/instance',{headers:{Authorization:'Bearer '+url.hash.slice(1)},signal:AbortSignal.timeout(1500)});
      const identity=await r.json();
      return r.ok&&identity.publisher==='lumina-local-publisher-v1'&&identity.root===hash(root)&&identity.projectId===projectId?{url:record.url,reused:true,server:null}:null;
    }catch{return null;}
  }
  const running=await existing();if(running)return running;
  let publisher;
  try{
    publisher=await createPublisher({port,...options});
    await atomic(runtime,JSON.stringify({root:hash(root),url:publisher.url}),{mode:0o600});
    return {...publisher,reused:false};
  }catch(e){
    if(publisher)await new Promise(r=>publisher.server.close(r));
    if(e.code!=='EADDRINUSE')throw e;
    // A simultaneous launcher may have bound the port before writing its record.
    for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,100));const running=await existing();if(running)return running;}
    throw new Error(`本机端口 ${port} 已被其他服务占用，未关闭或替换该服务。请检查占用后重试。`);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const publisher=await launchPublisher();console.log((publisher.reused?'已打开运行中的本机作者服务：':'Lumina owner publisher (loopback only):')+'\n'+publisher.url);
    if(process.argv.includes('--open')&&process.platform==='win32')spawn('powershell.exe',['-NoProfile','-Command',"Import-Module ($PSHOME + '/Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1') -ErrorAction Stop;Start-Process -FilePath 'microsoft-edge:"+publisher.url+"'"],{windowsHide:true,stdio:'ignore'});
  }catch(e){console.error(e.code==='EADDRINUSE'?'作者服务端口已被占用。':e.message);process.exitCode=1;}
}
