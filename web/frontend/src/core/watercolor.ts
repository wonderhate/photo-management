// Dedicated watercolor layout. General repaint styles must not redefine it.
export type WatercolorLayout={title:string;title_source:'manual'|'suggested'|'none';title_evidence:string;layout:'airy'|'reference';font:string;paper:number};
const fonts=['chinese_handwriting','chinese_brush','chinese_running','chinese_cursive','fine','brush','calligraphy','text'];
export function watercolorLayout(input:unknown):WatercolorLayout{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid watercolor layout.');
  const value=input as Record<string,unknown>,keys=['title','title_source','title_evidence','layout','font','paper'];
  if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Invalid watercolor layout.');
  const result={title:'',title_source:'manual',title_evidence:'',layout:'airy',font:'chinese_handwriting',paper:.35,...value};
  if(typeof result.title!=='string'||result.title.length>80||/[\u0000-\u001f]/.test(result.title)||
    typeof result.title_evidence!=='string'||result.title_evidence.length>300||
    !['manual','suggested','none'].includes(String(result.title_source))||!['airy','reference'].includes(String(result.layout))||
    !fonts.includes(String(result.font))||typeof result.paper!=='number'||!Number.isFinite(result.paper)||result.paper<0||result.paper>1)throw new Error('Invalid watercolor layout.');
  return {...result,title:result.title.trim()} as WatercolorLayout;
}
