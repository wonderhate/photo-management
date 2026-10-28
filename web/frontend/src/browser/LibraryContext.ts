import {createContext} from 'react';

export type LibraryIntent='import'|'save'|'editor-open';
export const BrowserLibraryContext=createContext({
  preview:false,
  importAfterOpen:false,
  pendingAfterOpen:null as LibraryIntent|null,
  finishPendingAction:()=>{},
  requestLibrary:(_intent:LibraryIntent)=>{},
});
