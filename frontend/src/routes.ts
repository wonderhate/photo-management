export type Page='home'|'photos'|'albums'|'smart'|'stats'|'reports'|'watermark'|'watermark-gallery'|'watercolor'|'timeline'|'compare'|'faces'|'settings';
const pages:Page[]=['home','photos','albums','smart','stats','reports','watermark','watermark-gallery','watercolor','timeline','compare','faces','settings'];
export function pageFromURL(pathname:string,search:string):Page{
  if(pathname==='/watercolor')return 'watercolor';
  if(pathname==='/watermark/gallery')return 'watermark-gallery';
  if(pathname.startsWith('/watermark'))return 'watermark';
  for(const page of ['timeline','compare','faces'] as const)if(pathname==='/'+page)return page;
  const page=new URLSearchParams(search).get('page') as Page;
  return pages.includes(page)?page:'home';
}
