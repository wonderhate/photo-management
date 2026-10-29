import {test,expect} from '@playwright/test';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const assets=fileURLToPath(new URL('../dist-web/assets/',import.meta.url));
const modelsModule='/assets/'+readdirSync(assets).find(name=>/^vision-models-.*\.js$/.test(name));

test('temporary darkroom model status never reads a persistent model database',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('lang','zh');window.__modelIDBAccess=0;
    indexedDB.open=()=>{window.__modelIDBAccess++;throw new Error('This tryout must not read persistent model storage.');};
  });
  await page.goto('/?local=1&demo=1#/');
  await expect(page.locator('.editor-page')).toBeVisible();
  const result=await page.evaluate(async module=>{
    const store=await import(module),before=await store.browserVisionModels();
    const first=before[0];if(!first)throw new Error('Expected pinned browser model specifications.');
    let missing='',invalid='';
    try{await store.visionModelFiles(first.id);}catch(error){missing=error.message;}
    try{await store.importVisionModel(first.id,[],true);}catch(error){invalid=error.message;}
    const after=await store.browserVisionModels();
    return {before:before.map(model=>model.installed),after:after.map(model=>model.installed),missing,invalid,access:window.__modelIDBAccess};
  },modelsModule);
  expect(result.before.every(value=>!value)).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.missing).toContain('Import the pinned local model files');
  expect(result.invalid).toContain('Choose every file');
  expect(result.access).toBe(0);
});
