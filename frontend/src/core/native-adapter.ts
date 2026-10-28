import {IS_BROWSER} from '../runtime';
import {api} from '../api';
export type ImportSelection={kind:'paths';paths:string[]}|{kind:'file-input'};
export interface NativeAdapter {
  pickOriginals(kind:'files'|'directory'):Promise<ImportSelection>;
}
// Keep file-input selection inside the user gesture; browsers cannot return OS paths.
const browser:NativeAdapter={async pickOriginals(kind){if(kind==='files')return {kind:'file-input'};const result=await api<{paths:string[]}>('/dialog/directory','POST');return {kind:'paths',paths:result.paths};}};
const native:NativeAdapter={async pickOriginals(kind){const result=await api<{paths:string[]}>('/dialog/'+kind,'POST');return {kind:'paths',paths:result.paths};}};
export const nativeAdapter=IS_BROWSER?browser:native;
