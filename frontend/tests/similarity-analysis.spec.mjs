import {test,expect} from '@playwright/test';
import {synthetic,photos,albums} from './fixtures/workspace.mjs';

for(const [lang,width] of [['zh',1440],['en',390]])test(`similarity menu inspector and original viewer ${lang} ${width}`,async({page},info)=>{
 const {errors}=await synthetic(page,{lang,width,theme:lang==='en'?'light':'dark',reducedMotion:'reduce'});
 await page.route('**/api/similarity/**',route=>route.fulfill({json:route.request().url().endsWith('/analysis')?{indexed:true,palette:['#709090']}:{mode:'appearance',candidates:[{...photos[1],appearance_distance:2}]}}));
 await page.goto('/?page=photos');const card=page.locator('.photo-card').filter({hasText:photos[0].file_name}).locator('.photo-image');
 await card.click({button:'right'});await page.getByRole('menuitem',{name:lang==='zh'?'按外观查相似照片':'Find photos with similar appearance'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').screenshot({path:info.outputPath('similarity-'+lang+'.png')});await page.getByRole('button',{name:(lang==='zh'?'打开相似照片：':'Open similar photo: ')+photos[1].file_name}).click();
 await expect(page.locator('.detail-image')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.detail-image')).toHaveCount(0);
 await card.hover();await expect(page.locator('.photo-similarity.compact')).toBeVisible({timeout:4000});await expect(page.locator('.similar-strip .similar-candidate')).toHaveCount(1);
 expect(errors).toEqual([]);
});

test('statistics scope and chart drilldown preserve existing narrow filters',async({page})=>{
 const {errors}=await synthetic(page);const requests=[];
 await page.route('**/api/stats?**',route=>{requests.push(new URL(route.request().url()).searchParams);return route.fulfill({json:{summary:{total:1,cameras:1,lenses:1,common_focal:50},charts:{focal_length:[{label:'24–70 mm',count:1,filter:{focal_length_min:24,focal_length_lt:70}}]}}});});
 await page.goto('/?page=stats&focal_length_min=50&favorite=true');await page.getByRole('checkbox',{name:'使用当前照片库筛选范围'}).check();
 await expect.poll(()=>requests.at(-1)?.get('focal_length_min')).toBe('50');expect(requests.at(-1).get('favorite')).toBe('true');
 const request=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/photos/ids'&&new URL(r.url()).searchParams.has('scope'));
 await page.locator('.chart-legend button').click();const query=new URL((await request).url()).searchParams,scope=JSON.parse(query.get('scope'));
 expect(scope.base.focal_length_min).toBe('50');expect(scope.base.favorite).toBe('true');const ast=typeof scope.base.query==='string'?JSON.parse(scope.base.query):scope.base.query;
 expect(ast.root).toMatchObject({op:'and',children:[{op:'gte',field:'focal_length',value:24},{op:'lt',field:'focal_length',value:70}]});expect(errors).toEqual([]);
});

test('smart rematch keeps manual members and cancellation rejects a late proposal',async({page})=>{
 const {errors}=await synthetic(page);const album={...albums[0],type:'smart',match_mode:'all',threshold:-.1,max_results:75,keywords:['海岸']};let saves=0,release;
 await page.route('**/api/albums',route=>route.fulfill({json:[album]}));
 await page.route('**/api/albums/'+album.id+'/rerun',route=>route.fulfill({json:{candidates:[photos[0],photos[1]],selected_photo_ids:[photos[0].id]}}));
 await page.route('**/api/albums/'+album.id+'/photos',route=>{saves++;return route.fulfill({json:album});});
 await page.goto('/?page=smart');await page.getByTitle('重新匹配',{exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog').locator('.photo-card.selected')).toHaveCount(1);await expect(page.getByRole('dialog').getByText('匹配阈值 · -0.10')).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();expect(saves).toBe(0);
 await page.route('**/api/albums/smart/preview',async route=>{await new Promise(resolve=>release=resolve);await route.fulfill({json:{candidates:[photos[2]]}}).catch(()=>{});});
 await page.getByRole('button',{name:'新建智能影集',exact:true}).click();await page.getByPlaceholder('海边，日落（用逗号分隔）').fill('海岸');await page.getByRole('button',{name:'预览候选照片',exact:true}).click();
 await expect.poll(()=>!!release).toBe(true);await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();release();
 await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'新建智能影集',exact:true}).click();await expect(page.getByRole('dialog').locator('.photo-card')).toHaveCount(0);expect(saves).toBe(0);expect(errors).toEqual([]);
});
