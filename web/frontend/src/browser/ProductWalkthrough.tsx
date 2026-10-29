import {useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import type {Lang} from '../i18n';
import './product-walkthrough.css';

export default function ProductWalkthrough({lang,demoHref}:{lang:Lang;demoHref:string}){
  const [step,setStep]=useState(0);
  const t=(zh:string,en:string)=>lang==='en'?en:zh;
  const steps=[
    {image:'original',title:t('从一张示例开始','Start with a sample'),body:t('下方展示内置插画的原始画面。进入体验会加载网站当前示例，也可换用自己的本机照片。','This is the original built-in illustration. The tryout loads the website’s current sample; you can also choose your own local photograph.'),alt:t('程序绘制的风景示例原图，包含山形、水面和天空。','Original program-drawn landscape with mountains, water and sky.')},
    {image:'adjusted',title:t('调整亮度与色彩','Adjust light and color'),body:t('这张结果使用曝光 +0.5、饱和度 +25。体验中可使用完整暗房，调整光线、曲线、构图与更多细节。','This result uses +0.5 exposure and +25 saturation. The tryout provides the full darkroom for light, curves, composition and more.'),alt:t('通过本地图像编辑器调整曝光与饱和度后的示例。','Sample after exposure and saturation adjustment in the local image editor.')},
    {image:'framed',title:t('加上留白与署名','Add a border and signature'),body:t('这张示例由相框渲染器生成。体验中可在完整水印工坊选择相框、标志与署名，第 3 步再下载成品。','This sample was made with the frame renderer. In the full Watermark Workshop, choose a frame, logo and signature, then download in step 3.'),alt:t('实际相框渲染器导出的示例图片，含纸面留白与署名。','Actual exported sample from the frame renderer, with a paper border and signature.')}
  ];
  return <div className="product-walkthrough">
    <div className="sec-head"><div><p className="eyebrow">{t('一次完整的小体验','A SMALL, COMPLETE TRYOUT')}</p><h2 id="product-preview-title">{t('看见变化，再决定是否使用。','See the result before you begin.')}</h2><p>{t('下面是同一张内置插画编辑前后的真实结果。进入体验，使用网站示例或自己的照片，完成暗房、水印工坊与下载三步流程。','These are real before-and-after outputs from the same built-in illustration. Open the tryout to use the website sample or your own photo through the darkroom, Watermark Workshop and download.')}</p></div><a className="link-arrow" href={demoHref}>{t('用示例体验','Try the sample')}<ArrowUpRight size={16}/></a></div>
    <div className="product-walkthrough-grid"><ol className="product-steps">{steps.map((item,index)=><li key={item.image}><button type="button" aria-pressed={step===index} aria-controls="product-step-preview" onClick={()=>setStep(index)}><span className="product-step-number">0{index+1}</span><span><strong>{item.title}</strong><span>{item.body}</span></span></button></li>)}</ol><figure id="product-step-preview" className="product-preview" aria-live="polite"><img src={`/demo/lumina-${steps[step].image}.png`} alt={steps[step].alt} width={step===2?1308:1200} height={step===2?998:800} loading="lazy"/><figcaption>{steps[step].title} · {t('程序绘制示例，非摄影作品','Program-drawn sample, not a photograph')}</figcaption></figure></div>
    <p className="product-boundary">{t('本机体验不需要建库：使用网站示例或自行选图，体验完整暗房及本地水印功能，最后下载 JPG、PNG 或 WebP。临时编辑在退出或刷新后清空，水印工坊不提供云端 AI。正式图库仍需授权本地数据目录。','No library setup is needed for the local tryout: use the website sample or choose a photo, try the full darkroom and local watermark features, then download JPG, PNG or WebP. Temporary edits clear on exit or refresh; the Watermark Workshop has no cloud AI. A personal library still requires local folder permission.')}</p>
  </div>;
}
