export type Page='ai-studio'|'home'|'locations'|'videos'|'photos'|'albums'|'smart'|'stats'|'reports'|'watermark'|'watermark-gallery'|'watercolor'|'timeline'|'compare'|'faces'|'settings'|'tools'|'darkroom';
const pages:Page[]=['ai-studio','home','locations','videos','photos','albums','smart','stats','reports','watermark','watermark-gallery','watercolor','timeline','compare','faces','settings','tools','darkroom'];
export function pageFromURL(pathname:string,search:string):Page{
  if(pathname==='/ai-studio')return 'ai-studio';
  if(pathname==='/tools')return 'tools';
  if(['/tools/darkroom','/tools/analyze','/tools/raw','/tools/edit'].includes(pathname))return 'darkroom';
  if(pathname==='/watercolor')return 'watercolor';
  if(pathname==='/watermark/gallery')return 'watermark-gallery';
  if(pathname.startsWith('/watermark'))return 'watermark';
  for(const page of ['timeline','compare','faces'] as const)if(pathname==='/'+page)return page;
  const page=new URLSearchParams(search).get('page') as Page;
  if(['analyze','raw','edit'].includes(page))return 'darkroom';
  return pages.includes(page)?page:'home';
}
