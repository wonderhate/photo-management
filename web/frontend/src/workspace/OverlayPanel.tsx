import {bt} from '../browser/text';
import type {OverlayLayer,GradientStop} from '../core/layer-stack';
export default function OverlayPanel({layer,onChange}:{layer:OverlayLayer;onChange:(layer:OverlayLayer)=>void}){
  const set=(patch:Partial<OverlayLayer>)=>onChange({...layer,...patch}),p=layer.paint;
  const number=(label:string,value:number,min:number,max:number,step:number,change:(n:number)=>void)=><label>{label}<input type="number" aria-label={label} value={value} min={min} max={max} step={step} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))change(Math.max(min,Math.min(max,e.target.valueAsNumber)));}}/></label>;
  const color=(label:string,value:string,change:(s:string)=>void)=><label>{label}<input type="color" aria-label={label} value={value} onChange={e=>change(e.target.value)}/></label>;
  const stops=(rows:GradientStop[])=>{if(p.kind==='linear')set({paint:{...p,stops:[...rows].sort((a,b)=>a.offset-b.offset)}});};
  return <fieldset className="text-fields overlay-fields" disabled={layer.locked}><legend>{bt('蒙层样式','Overlay style')}</legend>
    <label>{bt('蒙层填充','Overlay fill')}<select aria-label={bt('蒙层填充','Overlay fill')} value={p.kind} onChange={e=>set({paint:e.target.value==='solid'?{kind:'solid',color:'#000000',opacity:1}:{kind:'linear',angle:90,stops:[{offset:0,color:'#000000',opacity:0},{offset:1,color:'#000000',opacity:1}]}})}><option value="solid">{bt('纯色','Solid')}</option><option value="linear">{bt('多色渐变','Multi-stop gradient')}</option></select></label>
    {number(bt('蒙层透明度','Overlay opacity'),layer.opacity,0,1,.01,n=>set({opacity:n}))}
    <label>{bt('覆盖起边','Coverage edge')}<select aria-label={bt('覆盖起边','Coverage edge')} value={layer.edge} onChange={e=>set({edge:e.target.value as OverlayLayer['edge']})}>{(['top','bottom','left','right'] as const).map((edge,i)=><option key={edge} value={edge}>{[bt('顶部','Top'),bt('底部','Bottom'),bt('左侧','Left'),bt('右侧','Right')][i]}</option>)}</select></label>
    {number(bt('覆盖比例','Coverage'),layer.coverage,.01,1,.01,n=>set({coverage:n}))}
    {p.kind==='solid'?<div className="text-field-grid">{color(bt('蒙层颜色','Overlay color'),p.color,color=>set({paint:{...p,color}}))}{number(bt('填充透明度','Fill opacity'),p.opacity,0,1,.01,opacity=>set({paint:{...p,opacity}}))}</div>:<>
      {number(bt('渐变角度','Gradient angle'),p.angle,-360,360,1,angle=>set({paint:{...p,angle}}))}
      <p className="muted">{bt('0° 从左到右，90° 从上到下；色标按位置排序。','0° runs left to right, 90° top to bottom. Stops are sorted by position.')}</p>
      {p.stops.map((s,i)=><fieldset className="overlay-stop" key={i}><legend>{bt('色标 ','Stop ')+(i+1)}</legend>{color(bt('色标颜色 ','Stop color ')+(i+1),s.color,color=>stops(p.stops.map((v,j)=>j===i?{...v,color}:v)))}<div className="text-field-grid">{number(bt('色标位置 ','Stop position ')+(i+1),s.offset,0,1,.01,offset=>stops(p.stops.map((v,j)=>j===i?{...v,offset}:v)))}{number(bt('色标透明度 ','Stop opacity ')+(i+1),s.opacity,0,1,.01,opacity=>stops(p.stops.map((v,j)=>j===i?{...v,opacity}:v)))}</div><button disabled={p.stops.length<=2} onClick={()=>stops(p.stops.filter((_,j)=>j!==i))}>{bt('删除色标 ','Remove stop ')+(i+1)}</button></fieldset>)}
      <button disabled={p.stops.length>=16} onClick={()=>stops([...p.stops,{offset:.5,color:'#c9985f',opacity:.5}])}>{bt('添加色标','Add stop')}</button>
    </>}
    <p className="muted">{bt('从所选边缘覆盖照片。图层列表上方的内容显示在更上层；照片调色不改变文字和蒙层。','Coverage starts at the chosen edge. Items higher in the list appear on top; photo adjustments leave text and overlays unchanged.')}</p>
  </fieldset>;
}
