import {useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import type {Lang} from '../i18n';
import './product-walkthrough.css';

export default function ProductWalkthrough({lang,demoHref}:{lang:Lang;demoHref:string}){
  const [step,setStep]=useState(0);
  const t=(zh:string,en:string)=>lang==='en'?en:zh;
  const steps=[
    {image:'original',title:t('从一张示例开始','Start with a sample'),body:t('用程序绘制的风景图，不读取你的照片，也不用先建图库。','A program-drawn landscape. No access to your photographs and no library setup.'),alt:t('程序绘制的风景示例原图，包含山形、水面和天空。','Original program-drawn landscape with mountains, water and sky.')},
    {image:'adjusted',title:t('调整亮度与色彩','Adjust light and color'),body:t('这张结果使用曝光 +0.5、饱和度 +25。进入示例可自己调节并比较。','This result uses +0.5 exposure and +25 saturation. Open the sample to change the settings and compare.'),alt:t('通过本地图像编辑器调整曝光与饱和度后的示例。','Sample after exposure and saturation adjustment in the local image editor.')},
    {image:'framed',title:t('加上留白与署名','Add a border and signature'),body:t('通过相框渲染器生成纸面留白与署名，下载为一份新 PNG。','The frame renderer adds a paper border and signature. Download the result as a new PNG.'),alt:t('实际相框渲染器导出的示例图片，含纸面留白与署名。','Actual exported sample from the frame renderer, with a paper border and signature.')}
  ];
  return <div className="product-walkthrough">
    <div className="sec-head"><div><p className="eyebrow">{t('一次完整的小体验','A SMALL, COMPLETE TRYOUT')}</p><h2 id="product-preview-title">{t('看见变化，再决定是否使用。','See the result before you begin.')}</h2><p>{t('下面是同一张示例经过本地编辑与相框导出的真实结果。点击步骤切换，也可以亲手试一次。','These are real outputs from the same sample, processed by the local editor and frame renderer. Select a step or try it yourself.')}</p></div><a className="link-arrow" href={demoHref}>{t('用示例体验','Try the sample')}<ArrowUpRight size={16}/></a></div>
    <div className="product-walkthrough-grid"><ol className="product-steps">{steps.map((item,index)=><li key={item.image}><button type="button" aria-pressed={step===index} aria-controls="product-step-preview" onClick={()=>setStep(index)}><span className="product-step-number">0{index+1}</span><span><strong>{item.title}</strong><span>{item.body}</span></span></button></li>)}</ol><figure id="product-step-preview" className="product-preview" aria-live="polite"><img src={`/demo/lumina-${steps[step].image}.png`} alt={steps[step].alt} width={step===2?1308:1200} height={step===2?998:800} loading="lazy"/><figcaption>{steps[step].title} · {t('程序绘制示例，非摄影作品','Program-drawn sample, not a photograph')}</figcaption></figure></div>
    <p className="product-boundary">{t('示例只演示曝光、饱和度与相框导出；不代表 RAW 兼容性或 AI 生成效果。正式图库仍需在电脑 Chrome / Edge 中授权本地数据目录。','The sample demonstrates exposure, saturation and frame export. It does not demonstrate RAW compatibility or AI generation. A personal library requires local folder permission in desktop Chrome / Edge.')}</p>
  </div>;
}
