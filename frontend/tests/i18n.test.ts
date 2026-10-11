import test from 'node:test';
import assert from 'node:assert/strict';
import {t,getLang,setStoredLang,monthName} from '../src/i18n.ts';

test('English translations handle counts, saved statuses, dates and user content',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const saved=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)}});
  try{
    assert.equal(t('新建人物影集'),'新建人物影集');
    setStoredLang('en');
    assert.equal(getLang(),'en');
    assert.equal(t('新建人物影集'),'Create Person Album');
    assert.equal(t('已创建人物影集「{0}」· {1} 次拍摄',{0:'家人 {1}',1:81}),'Created person album "家人 {1}" · 81 captures');
    assert.equal(t('人物任务完成：3 成功，2 跳过，1 失败'),'People task finished: 3 succeeded, 2 skipped, 1 failed');
    assert.equal(t('保存失败：目录不可写'),'Save failed: Folder is not writable');
    assert.equal(t('共收藏 3 张大光圈照片\n3'),'Favorited 3 wide-aperture photos\n3');
    assert.equal(t('2026年09月29日'),'2026-09-29');
    assert.equal(t(' 次拍摄 '),' captures ');
    assert.equal(monthName('09'),'September');
    assert.equal(t('用户自己的内容'),'用户自己的内容');
    setStoredLang('zh');
    assert.equal(monthName('09'),'9月');
    assert.equal(t('批量编辑 · {0} 张照片',{0:3}),'批量编辑 · 3 张照片');
  }finally{
    if(original)Object.defineProperty(globalThis,'localStorage',original);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
