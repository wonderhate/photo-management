import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// Shared UI adapters and browser storage can have the same chunk prefix.
// Resolve the exported contract instead of depending on hash sort order.
function contractModule(assets,prefix,name){
  const file=readdirSync(assets).find(file=>file.startsWith(prefix+'-')&&file.endsWith('.js')&&new RegExp('export\\s*\\{[^}]*\\b'+name+'\\b[^}]*\\}').test(readFileSync(join(assets,file),'utf8').slice(-2000)));
  if(!file)throw new Error(`Missing ${name} production export.`);
  return '/assets/'+file;
}
export const browserApiModule=assets=>contractModule(assets,'api','browserAPI');
export const browserEditorModule=assets=>contractModule(assets,'editor-adapter','createEditorServices');
