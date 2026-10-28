import {newTextLayer,validateTextLayer} from './text-layers.ts';
import type {TextLayer,TextPaint} from './text-layers.ts';

// Typography values adapted from AfterFrame's MIT-licensed textState presets.
// Font families use PhotoCollection's existing local fonts; no remote loading.
const solid=(color:string,opacity=1):TextPaint=>({kind:'solid',color,opacity});
const gradient=(from:string,to:string,angle:number):TextPaint=>({kind:'linear',from,to,angle,fromOpacity:1,toOpacity:1});
const shadow=(color:string,opacity:number,x:number,y:number,blur:number):TextLayer['shadow']=>({enabled:true,color,opacity,x,y,blur});
const background=(color:string,opacity:number,side:number):TextLayer['background']=>({enabled:true,paint:solid(color,opacity),padding:[22,side,22,side]});
type Preset={id:string;zh:string;en:string;style:Partial<TextLayer>};
export const TEXT_PRESETS:readonly Preset[]=[
  {id:'dune',zh:'沙丘',en:'Dune',style:{weight:300,size:200,textCase:'upper',letterSpacing:.55,opacity:.96}},
  {id:'2049',zh:'2049',en:'2049',style:{weight:800,size:130,textCase:'upper',letterSpacing:.02,fill:gradient('#ffa24d','#d43f24',175),shadow:shadow('#1a0a06',.8,0,4,0)}},
  {id:'vertical',zh:'金色题字',en:'Vertical',style:{font:'chinese_brush',weight:700,size:96,lineHeight:1.12,fill:solid('#e3b96f')}},
  {id:'stacked',zh:'叠字',en:'Stacked',style:{font:'serif',weight:700,size:120,textCase:'upper',lineHeight:1.02,letterSpacing:.05,fill:solid('#f0e3c8')}},
  {id:'billing',zh:'片尾字幕',en:'Billing',style:{weight:500,size:34,textCase:'upper',letterSpacing:.18,lineHeight:2,opacity:.8}},
  {id:'noir',zh:'黑色电影',en:'Noir',style:{font:'serif',weight:600,size:130,italic:true,letterSpacing:.02,fill:solid('#efe8da'),shadow:shadow('#000000',.6,0,3,10)}},
  {id:'cinema',zh:'电影标题',en:'Cinema',style:{font:'chinese_handwriting',weight:500,size:66,letterSpacing:.12,lineHeight:1.75,shadow:shadow('#000000',.55,0,2,14)}},
  {id:'ghost',zh:'空心轮廓',en:'Ghost',style:{weight:800,size:170,textCase:'upper',letterSpacing:.18,fill:solid('#ffffff',0),stroke:{enabled:true,width:2,paint:solid('#ffffff')}}},
  {id:'gold',zh:'金箔',en:'Gold Foil',style:{font:'serif',weight:700,size:150,letterSpacing:.04,fill:gradient('#f6e3a8','#b97f2e',170),shadow:shadow('#d8a648',.35,0,2,18)}},
  {id:'neon',zh:'霓虹',en:'Neon',style:{weight:800,size:150,italic:true,letterSpacing:.03,fill:gradient('#7de3ff','#ff5ad0',100),shadow:shadow('#8f5aff',.65,0,4,30)}},
  {id:'editorial',zh:'杂志',en:'Editorial',style:{size:52,textCase:'upper',letterSpacing:.42,opacity:.92}},
  {id:'whisper',zh:'低语',en:'Whisper',style:{weight:300,size:46,textCase:'lower',letterSpacing:.6,opacity:.45}},
  {id:'typewriter',zh:'打字机',en:'Typewriter',style:{font:'mono',size:48,textCase:'lower',letterSpacing:.02,lineHeight:1.7,fill:solid('#f5efe4'),opacity:.88,align:'left'}},
  {id:'label',zh:'纸签',en:'Label',style:{weight:700,size:54,textCase:'upper',letterSpacing:.28,fill:solid('#111111'),background:background('#f2efe8',.95,45)}},
  {id:'seal',zh:'朱印',en:'Red Seal',style:{font:'chinese_brush',weight:900,size:72,letterSpacing:.14,background:background('#c8102e',.96,40)}},
  {id:'riso',zh:'套色印刷',en:'Riso',style:{weight:800,size:130,textCase:'upper',letterSpacing:.06,fill:solid('#fffdf5'),shadow:shadow('#e03616',.9,5,5,0)}},
  {id:'scribble',zh:'随笔',en:'Scribble',style:{font:'brush',weight:700,size:150,rotation:-4,shadow:shadow('#000000',.4,0,4,12)}},
];
export function applyTextPreset(layer:TextLayer,id:string):TextLayer{
  validateTextLayer(layer);const preset=TEXT_PRESETS.find(p=>p.id===id);if(!preset)throw new Error('Invalid text preset.');
  const next={...newTextLayer(layer.id,layer.text),...structuredClone(preset.style),x:layer.x,y:layer.y,visible:layer.visible,locked:layer.locked};validateTextLayer(next);return next;
}
