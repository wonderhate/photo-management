import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLutTree,lutTreePage,LUT_TREE_ROW_BUDGET} from '../src/core/lut-tree.ts';
import {lutViewDefaults} from '../src/core/lut-view.ts';
import {orderLuts,lutGroupedStep} from '../src/core/lut-order.ts';
import type {LutAsset} from '../src/core/lut-contract.ts';
test('fully expanded LUT trees keep a global row budget and every deep directory reachable',()=>{
 const groups=Array.from({length:5000},(_,i)=>['G'+String(i).padStart(4,'0'),...Array.from({length:8},(_,n)=>'Depth'+n)]),root=buildLutTree('Large',groups),view={...lutViewDefaults,treeExpanded:true};
 let mounted=0;for(let i=0;i<20;i++){const page=lutTreePage(root,'folder-'+i,view,0,Math.floor(LUT_TREE_ROW_BUDGET/20));mounted+=page.rows.length+1;assert.equal(page.total,45000);assert.equal(page.rows[8].depth,9);}
 assert.ok(mounted<=LUT_TREE_ROW_BUDGET+20);const last=lutTreePage(root,'last',view,Math.ceil(45000/240)-1,240);assert.equal(last.rows.at(-1)?.node.path,groups.at(-1)!.join('/'));
 assert.equal(lutTreePage(root,'last',{...view,treeExpanded:false},100,240).rows.length,0);assert.equal(lutTreePage(root,'last',view,99999,240).page,0);
});
test('LUT favorites and stable recent snapshots are grouped once without duplicate styles',()=>{
 const asset=(id:string,favorite=false):LutAsset=>({version:1,id,name:id,title:'',size:2,bytes:100,favorite,hidden:false,used_at:null});
 const values=[asset('a'),asset('b',true),asset('c'),asset('d')],ordered=orderLuts(values,'all',['c','b','a']);assert.deepEqual(ordered.rows.map(a=>a.id),['b','c','a','d']);assert.deepEqual(ordered.groups,['favorite','recent','recent','other']);assert.equal(new Set(ordered.rows.map(a=>a.id)).size,4);assert.deepEqual(values.map(a=>a.id),['a','b','c','d']);
 assert.deepEqual(orderLuts(values,'recent',['d','b','a','c']).rows.map(a=>a.id),['d','b','a','c']);
});
test('LUT arrows follow ragged group rows and page boundaries rather than heading positions',()=>{
 const groups=['favorite','favorite','favorite','recent','recent','recent','other'];
 assert.equal(lutGroupedStep(1,groups,2,'ArrowDown',4),2);assert.equal(lutGroupedStep(2,groups,2,'ArrowDown',4),3);assert.equal(lutGroupedStep(3,groups,2,'ArrowDown',4),4);assert.equal(lutGroupedStep(5,groups,2,'ArrowUp',4),3);assert.equal(lutGroupedStep(2,groups,2,'ArrowRight',4),3);assert.equal(lutGroupedStep(6,groups,2,'ArrowDown',4),6);
});
