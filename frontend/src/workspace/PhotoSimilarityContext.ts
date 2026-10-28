import {createContext} from 'react';
import type {Photo} from '../types';
export type SimilarityMode='appearance'|'semantic';
export type SimilarityActions={menu:(photo:Photo,anchor:HTMLElement,x:number,y:number)=>void;expand:(photo:Photo,mode:SimilarityMode)=>void;open:(photo:Photo)=>void;color:(value:string)=>void;settings:()=>void};
export const PhotoSimilarityContext=createContext<SimilarityActions|null>(null);
