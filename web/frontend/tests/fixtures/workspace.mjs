

// Synthetic landscapes and metadata only; no user's library is read by these tests.
const photos=Array.from({length:7},(_,i)=>({id:'frame-'+i,file_name:'FRAME_0'+i+'.jpg',capture_group_id:'capture-'+i,file_format:'JPG',file_size:400000,width:i===1?600:i===2?1800:1200,height:i===1?900:i===2?500:800,date_taken:'2026-10-01T18:30:00',camera_model:'TEST CAMERA',camera_make:'TEST',lens_model:'50mm F1.8',focal_length:50,f_number:2.8,exposure_time:'1/125',iso:400,thumbnail_path:'synthetic',thumbnail_url:'/api/photos/frame-'+i+'/thumbnail',preview_url:'/api/photos/frame-'+i+'/preview',favorite:false,rating:null,color_label:null,tags:[],gps_latitude:null,gps_longitude:null,raw_exif:{Model:'TEST CAMERA'},files:[{id:'frame-'+i,file_name:'FRAME_0'+i+'.jpg',file_format:'JPG',is_raw:false,file_path:'synthetic'}]}));
const albums=Array.from({length:5},(_,i)=>({id:'collection-'+i,name:['山的回声','暮色之间','沿海散步','雪境','城市片刻'][i],type:'normal',count:7,keywords:[],cover_id:photos[i].id}));
async function synthetic(page,{theme='dark',width=1440,reducedMotion='no-preference',lang='zh'}={}){
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion});
  await page.addInitScript(({theme,lang})=>{localStorage.setItem('theme',theme);localStorage.setItem('lang',lang);localStorage.setItem('onboarded','1')},{theme,lang});
  const errors=[],edits=[];let viewPreferences={},toolPreferences={},facetPreferences={};
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())});
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),key=url.pathname.slice(4);
    if(key==='/health')return route.fulfill({json:{status:'ok'}});
    if(key==='/agent/settings')return route.fulfill({json:{enabled:false,scopes:['read'],catalog_id:'synthetic-library',endpoint:'/mcp'}});
    if(key==='/file-actions/capabilities')return route.fulfill({json:{copy:false,drag:false}});
    if(key.startsWith('/locations/photos/'))return route.fulfill({json:{photo_id:key.split('/').at(-1),source_hash:'a'.repeat(64),record:null,effective:{source:'none',latitude:null,longitude:null,country:'',city:'',label:'',accuracy_m:null},original:{latitude:null,longitude:null}}});
    if(key==='/workspace')return route.fulfill({json:{library_id:'synthetic-library',preferences:viewPreferences,tool_preferences:toolPreferences,facet_preferences:facetPreferences}});
    if(key==='/tags')return route.fulfill({json:{field:'tag',total:photos.length,missing:photos.length,values:[],page:1,has_more:false}});
    if(key==='/workspace/catalogs')return route.fulfill({json:{current:{path:'C:/synthetic-library',name:'synthetic-library',library_id:'synthetic-library',photo_count:7,schema_version:3},recent:[],pending:null,locked:true,migration_pending:false,managed_restart:false,switching:false,error:null}});
    if(key==='/facets/camera_model')return route.fulfill({json:{field:'camera_model',total:7,missing:0,values:[{value:'TEST CAMERA',count:7}],page:1,has_more:false}});
    if(key==='/workspace/facets'){facetPreferences={...facetPreferences,...req.postDataJSON().values};return route.fulfill({json:facetPreferences});}
    if(key==='/workspace/preferences'){
      const payload=req.postDataJSON();
      if(payload.library_id!=='synthetic-library')return route.fulfill({status:409,json:{detail:'Library changed.'}});
      viewPreferences={...viewPreferences,...payload.values};return route.fulfill({json:viewPreferences});
    }
    if(key.startsWith('/workspace/tools/')){
      const tool=key.split('/').at(-1),payload=req.postDataJSON();
      if(payload.library_id!=='synthetic-library')return route.fulfill({status:409,json:{detail:'Library changed.'}});
      toolPreferences[tool]={...toolPreferences[tool],...payload.values};return route.fulfill({json:toolPreferences[tool]});
    }
    if(/\/(thumbnail|preview)$/.test(key)){
      const index=Number(key.match(/frame-(\d)/)?.[1]||0),colors=[['#344a67','#d8a983'],['#283d32','#92aa9a'],['#534358','#eeb79b'],['#536a7d','#b4c6d4'],['#323d54','#b9a3b6']][index%5];
      return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${photos[index]?.width||1200}" height="${photos[index]?.height||800}" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#s)"/><circle cx="820" cy="250" r="55" fill="#f1d7ad"/><path d="M0 600L200 320 450 590 710 200 1000 610 1200 400V800H0" fill="#141e2b" opacity=".65"/><path d="M0 710L300 490 580 710 850 430 1200 710V800H0" fill="#0d1620"/><path d="M0 780Q400 690 1200 775V800H0" fill="#bfa680" opacity=".3"/></svg>`});
    }
    if(key==='/photos/by-ids')return route.fulfill({json:{photos:req.postDataJSON().ids.map(id=>photos.find(p=>p.id===id)).filter(Boolean)}});
    if(/^\/photos\/frame-\d+$/.test(key)){
      const photo=photos.find(p=>key.endsWith(p.id));
      if(req.method()==='PATCH'){const change=req.postDataJSON();edits.push(change);return route.fulfill({json:{...photo,...change}})}
      return route.fulfill({json:photo});
    }
    if(key==='/compare')return route.fulfill({json:{photos:photos.filter(p=>url.searchParams.get('ids').includes(p.id))}});
    if(key.startsWith('/similarity/photos/'))return route.fulfill({json:key.endsWith('/analysis')?{indexed:false,palette:[]}:{mode:'appearance',candidates:[]}});
    if(key.startsWith('/albums/'))return route.fulfill({json:albums.find(a=>key.endsWith(a.id))});
    const responses={'/settings':{count_mode:'capture',scan_paths:[]},'/filter-options':{camera_model:['TEST CAMERA'],tags:[]},'/library/scan':{job:null},'/jobs':[],'/ai/status':{status:'unavailable',indexed:0},'/photos/ids':{ids:photos.map(p=>p.id)},'/photos':{photos:photos.slice(0,5),total:7},'/albums':albums};
    if(!(key in responses))errors.push('Unexpected API '+key);
    return route.fulfill({json:responses[key]??{}});
  });
  return{errors,edits};
}

export {synthetic,photos,albums};
