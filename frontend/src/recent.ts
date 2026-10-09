export interface RecentOp {kind:'import'|'export'|'draft';label:string;time:number;payload?:{draft?:string;urls?:string[]}}
const KEY='recent-ops';
export function getRecent():RecentOp[] {try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}}
export function recordRecent(op:RecentOp) {try{const list=getRecent().filter(o=>!(o.kind==='draft'&&op.kind==='draft'&&o.payload?.draft===op.payload?.draft));list.unshift(op);localStorage.setItem(KEY,JSON.stringify(list.slice(0,12)))}catch{}}
export function clearRecent() {try{localStorage.removeItem(KEY)}catch{}}
