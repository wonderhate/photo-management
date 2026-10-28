import {collageCanvasStyle,collageTemplate,upgradeCollage,validateCollage} from './collage.ts';
import type {CollageScene} from './collage.ts';

// Original style recipes over the existing, licensed AfterFrame layouts. Presets
// serialize as ordinary scene values, so older projects and both renderers agree.
const balanced=['1-full','2-lr','3-cols','4-grid','5-t2-b3','6-3x2','7-t3-b4','8-4x2','9-3x3','10-5x2','11-t4-m3-b4','12-4x3'];
const portrait=['1-full','2-tb','3-top-2b','4-grid','5-t2-b3','6-2x3','7-t2-m3-b2','8-2x4','9-3x3','10-2x5','11-t4-m3-b4','12-3x4'];
const hero=['1-full','2-big-top','3-big-2small','4-big-3b','5-big-top-4b','6-t1-b5','7-big-top-6','8-big-7','9-big-top-8','10-big-top-9','11-2big-9','12-big-11'];
const strip=['1-full','2-lr','3-cols','4-cols','5-cols','6-3x2','7-t3-b4','8-4x2','9-3x3','10-5x2','11-t4-m3-b4','12-4x3'];
export const COLLAGE_PRESETS=[
 {id:'gallery',name:['画廊留白','Gallery white'],description:['宽边留白，让照片自由呼吸','Generous margins, room for each frame'],sampleCount:4,ratio:[1,1],gap:.018,padding:.09,radius:0,background:'#faf8f3',layouts:balanced},
 {id:'diptych',name:['双页叙事','Side by side'],description:['横向对照，串起同一段故事','A quiet landscape sequence'],sampleCount:2,ratio:[3,2],gap:.014,padding:.045,radius:0,background:'#eae5dc',layouts:balanced},
 {id:'film',name:['胶片连拍','Film sequence'],description:['深色窄框，收集连续的瞬间','Dark frames for a sequence of moments'],sampleCount:3,ratio:[3,2],gap:.012,padding:.055,radius:0,background:'#151515',layouts:strip},
 {id:'travel',name:['旅行手记','Travel journal'],description:['暖纸圆角，整理沿途的风景','Warm paper and softly rounded corners'],sampleCount:6,ratio:[4,5],gap:.024,padding:.045,radius:.018,background:'#eee5d3',layouts:portrait},
 {id:'editorial',name:['杂志主图','Editorial story'],description:['主图领衔，细节围绕展开','One lead image with supporting details'],sampleCount:4,ratio:[4,5],gap:.012,padding:.03,radius:0,background:'#ffffff',layouts:hero},
 {id:'grid',name:['方格集锦','Contact sheet'],description:['均衡方格，让一组照片彼此呼应','A balanced grid for a cohesive collection'],sampleCount:9,ratio:[1,1],gap:.012,padding:.025,radius:0,background:'#f1f1ef',layouts:balanced},
] as const;
export type CollagePresetId=typeof COLLAGE_PRESETS[number]['id'];

export function collagePresetCanvas(id:CollagePresetId,count:number){
 const preset=COLLAGE_PRESETS.find(p=>p.id===id);
 if(!preset||!Number.isInteger(count)||count<1||count>12)throw new Error('Invalid collage preset or photo count.');
 const template=preset.layouts[count-1];
 if(collageTemplate(template).cells.length!==count)throw new Error('Collage preset needs a matching layout.');
 const edge=2400,[w,h]=preset.ratio;
 return {version:2 as const,edge_blend:0,template,width:Math.round(edge*w/Math.max(w,h)),height:Math.round(edge*h/Math.max(w,h)),gap:preset.gap,padding:preset.padding,radius:preset.radius,background:preset.background};
}

/** Keep every original, visual order and crop; only replace the layout recipe. */
export function applyCollagePreset(scene:CollageScene,id:CollagePresetId):CollageScene{
 const next={...upgradeCollage(scene),...collagePresetCanvas(id,scene.cells.length)};
 validateCollage(next);return next;
}

export function matchingCollagePreset(scene:CollageScene):CollagePresetId|null{
 const style=collageCanvasStyle(scene);
 return COLLAGE_PRESETS.find(p=>{
  const {template,...candidate}=collagePresetCanvas(p.id,scene.cells.length);
  return scene.template===template&&(Object.keys(style) as (keyof typeof style)[]).every(key=>style[key]===candidate[key]);
 })?.id||null;
}
