import {createContext} from 'react';

export type LibraryIntent='import'|'save';
export const BrowserLibraryContext=createContext({
  preview:false,
  importAfterOpen:false,
  requestLibrary:(_intent:LibraryIntent)=>{},
});
