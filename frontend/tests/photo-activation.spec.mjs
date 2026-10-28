import {test,expect} from './fixtures/native-runtime.mjs';
import {synthetic} from './fixtures/workspace.mjs';
import {exercisePhotoActivation} from './fixtures/photo-activation.mjs';

for(const width of [320,390])for(const layout of ['justified','grid','tiles','waterfall'])test(`photos remain interactive immediately after scrolling ${layout} ${width}`,async({page},info)=>{
  const {errors}=await synthetic(page,{width,lang:'en',reducedMotion:'reduce'});await page.goto('/?page=photos');
  await exercisePhotoActivation(page,{id:'frame-6',name:'FRAME_06.jpg',layout,screenshot:info.outputPath('photo-activation.png')});
  expect(errors).toEqual([]);
});
