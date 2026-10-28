import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// The website has two API chunks (shared UI and browser storage). Select by the
// exported contract instead of whichever hash happens to sort first.
export function browserApiModule(assets){
  const name=readdirSync(assets).find(file=>/^api-.*\.js$/.test(file)&&/export\s*\{[^}]*\bbrowserAPI\b[^}]*\}/.test(readFileSync(join(assets,file),'utf8').slice(-2000)));
  if(!name)throw new Error('The browser API export is missing from the production build.');
  return '/assets/'+name;
}
