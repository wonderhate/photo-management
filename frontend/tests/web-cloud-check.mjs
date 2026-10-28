import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function run(args,env=process.env){const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.status!==0)throw new Error('Check failed: '+args.join(' '));}
const build=['frontend/node_modules/vite/bin/vite.js','build','--mode','browser','--config','frontend/vite.config.ts','frontend'];
try{
  run(build,{...process.env,VITE_ART_RELAY_URL:'wss://synthetic-relay.invalid/cloud-art'});
  run(['frontend/node_modules/@playwright/test/cli.js','test','--config','frontend/playwright.web.config.ts','--grep','cloud consent'],{...process.env,PHOTO_WEB_TEST_RELAY:'1'});
}catch(error){console.error(error.message);process.exitCode=1;}
finally{try{run(build);}catch(error){console.error(error.message);process.exitCode=1;}}
