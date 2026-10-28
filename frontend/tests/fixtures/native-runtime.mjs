import {test as base,expect} from '@playwright/test';

// Each browser context is fresh; the isolated native server's library is shared.
// Restore tool defaults between cases, never against an installed/personal library.
export const test=base.extend({
  resetToolPreferences:[async({request},use)=>{
    const health=await(await request.get('/api/health')).json();
    expect(health.data_dir.replaceAll('\\','/')).toContain('/.test-artifacts/theme-browser-');
    const {library_id}=await(await request.get('/api/workspace')).json();
    const settings=await(await request.get('/api/settings')).json();
    const defaults={lut:{columns:1,filter:'all',hideLog:false,strength:1,'collapse:favorite':false,'collapse:recent':false,'collapse:other':false,'collapse:hidden':false},viewer:{quality:0,pinned:false},compare:{linked:true},darkroom:{format:settings.export_format,edge:settings.export_long_edge,quality:settings.export_quality},split:{width:3,height:4}};
    for(const [tool,values] of Object.entries(defaults))expect((await request.patch('/api/workspace/tools/'+tool,{data:{library_id,values}})).ok()).toBe(true);
    expect((await request.patch('/api/workspace/facets',{data:{library_id,values:{hidden:['camera_make','file_format','orientation','color_label','favorite','is_raw','focal_length','f_number','iso','exposure_seconds','date_taken','created_at','description','user_description','ai_caption','detected_text']}}})).ok()).toBe(true);
    await use();
  },{auto:true}],
});
export {expect};
