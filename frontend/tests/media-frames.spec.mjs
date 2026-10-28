import {test,expect} from './fixtures/native-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {exerciseFrameV2,exerciseVideoPlayer} from './fixtures/media-frame-ui.mjs';

for(const lang of ['zh','en'])test('frame v2 templates and WebP retain source '+lang,async({page,request},info)=>{
  test.setTimeout(120000);await page.setViewportSize({width:lang==='en'?390:1440,height:1100});
  await page.addInitScript(lang=>{localStorage.setItem('lang',lang);localStorage.setItem('theme',lang==='en'?'light':'dark');localStorage.setItem('onboarded','1');},lang);
  const health=await(await request.get('/api/health')).json(),source=join(health.data_dir,'frame-v2-'+lang+'.png');
  execFileSync(process.env.PHOTO_TEST_PYTHON||'python',['-c',"from PIL import Image;import sys;Image.new('RGB',(640,480),sys.argv[2]).save(sys.argv[1])",source,lang==='zh'?'#357967':'#354967']);
  const before=createHash('sha256').update(readFileSync(source)).digest('hex'),job=await(await request.post('/api/photos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const photo=(await(await request.get('/api/photos')).json()).photos.find(p=>p.file_name==='frame-v2-'+lang+'.png');
  await page.goto('/watermark/workshop?photo='+photo.id);await exerciseFrameV2(page,lang,info);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(before);
});

test('video import playback range and removal preserve source and photo counts',async({page,request},info)=>{
  test.setTimeout(120000);await page.addInitScript(()=>{localStorage.setItem('lang','zh');localStorage.setItem('onboarded','1');});
  await page.goto('/?page=videos');const health=await(await request.get('/api/health')).json(),source=join(health.data_dir,'synthetic-video.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=24','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',source],{windowsHide:true});const bytes=readFileSync(source);
  const count=(await(await request.get('/api/photos')).json()).total,job=await(await request.post('/api/videos/import',{data:{paths:[source]}})).json();
  await expect.poll(async()=>(await(await request.get('/api/jobs/'+job.id)).json()).status).toBe('completed');
  const result=await(await request.get('/api/jobs/'+job.id)).json();expect(result.failed,result.errors?.join('\n')).toBe(0);
  await page.reload();await exerciseVideoPlayer(page,info);expect((await(await request.get('/api/photos')).json()).total).toBe(count);
  expect(readFileSync(source)).toEqual(bytes);
});
