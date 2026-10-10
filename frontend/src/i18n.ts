export type Lang='zh'|'en';
const KEY='lang';
const EN:Record<string,string>={
  '照片':'Photos','影集':'Albums','智能影集':'Smart Albums','地图':'Map','时间线':'Timeline','人物':'People','统计':'Statistics','摄影报告':'Reports','水印工坊':'Watermark','水印图库':'Gallery','设置':'Settings','我的收藏':'Favorites',
  '你的摄影空间':'Your Photography Space','本地照片库':'Local Library','原图保留 · 私密存储':'Originals kept · Private','照片工作室':'Photo Studio',
  '导入照片':'Import Photos','所有照片':'All Photos','影集照片':'Album Photos','每一次按下快门，都是值得留下的瞬间。':'Every shutter press is a moment worth keeping.',
  '上次筛选':'Last Filter','同步目录':'Sync Folder','选择可见':'Select Visible','已选':'Selected','制作水印':'Watermark','收入影集':'To Album','对比':'Compare','批量编辑':'Batch Edit','移出图库':'Remove','筛选':'Filter',
  '影集排序（可拖拽）':'Album Order (drag)','拍摄时间':'Date Taken','导入时间':'Date Imported','文件名称':'File Name',
  '相机':'Camera','镜头':'Lens','焦距':'Focal Length','光圈':'Aperture','快门':'Shutter','起始日期':'From','结束日期':'To','画幅':'Orientation','文件类型':'File Type','收藏':'Favorite','标签':'Tag','文件名':'File Name','评分':'Rating','颜色标签':'Color Label',
  '全部':'All','横幅':'Landscape','竖幅':'Portrait','方形':'Square','清除筛选':'Clear Filters','红色':'Red','黄色':'Yellow','绿色':'Green','蓝色':'Blue',
  '正在加载照片…':'Loading photos…','没有符合条件的照片':'No Matching Photos','试试调整筛选条件。':'Try adjusting the filters.','从第一张照片开始':'Start with Your First Photo','选择原始照片或整个目录。我们只登记路径，为你整理光圈、焦段和每一次拍摄。':'Choose photos or a whole folder. We only register paths, organizing aperture, focal length and every capture for you.','重试':'Retry',
  '导入你的照片':'Import Your Photos','选择照片':'Choose Photos','选择文件夹':'Choose Folder','单张 / 多张':'Single / Multiple','整目录扫描':'Recursive Scan','包含子文件夹':'Include subfolders','开始导入':'Start Import','请稍候…':'Please wait…','取消':'Cancel',
  '键盘快捷键':'Keyboard Shortcuts','最近操作':'Recent','清空':'Clear','暂无记录':'No records','欢迎来到光影集':'Welcome to Lumina','开始使用':'Get Started',
  '照片导入':'Import','水印导出':'Export','已完成':'Done','失败':'Failed','已取消':'Cancelled','处理中':'Running','取消任务':'Cancel Task','关闭任务':'Dismiss',
  '界面语言':'Language','选择界面语言，立即生效。':'Interface language, applies immediately.','中文':'Chinese','English':'English',
  '共':'Total','次拍摄 · 已加载':'captures · loaded',
  '仅 RAW':'RAW Only','仅 JPG / 非 RAW':'JPG Only','开始日期':'Start Date','星':'★',
  '已收藏':'Favorited','设为影集封面':'Set as Album Cover','保存标签':'Save Tags','本次拍摄文件':'Files in This Capture','打开原图':'Open Original','下载':'Download','文件位置':'Reveal in Folder','完整 EXIF':'Full EXIF','移出这次拍摄的记录（保留原图）':'Remove This Capture (originals kept)','查看水印作品':'Watermark Works',
  '成功':'Succeeded','跳过':'Skipped','查看错误':'View Errors','关闭详情 / 弹窗':'Close Detail / Dialog',
  '拖入照片':'Drop Photos Here','松开后选择导入方式':'Release to choose import method',
  '本地语义索引就绪':'Semantic Index Ready','照片仅在本机处理':'Photos processed locally only','为看见而收藏':'Kept for Seeing',
  '选择本地文件或文件夹，仅登记原图路径，自动去重并读取 EXIF。':'Choose local files or folders. We only register paths, dedupe automatically and read EXIF.',
  '导入第一批照片':'Import First Photos','文件 / 文件夹':'Files / Folder','了解快捷键':'Learn Shortcuts','按 ? 随时查看':'Press ? anytime',
  '本地优先的照片库：原图保留在原位置，所有分析都在本机完成，照片不会上传。':'Local-first library: originals stay in place, all analysis happens on this machine, nothing is uploaded.',
  '相机未知':'Unknown Camera','镜头信息未记录':'Lens not recorded','拍摄时间未知':'Unknown Date','原图已移动或删除。可重新导入新位置以按 hash 关联。':'Original moved or deleted. Re-import the new location to relink by hash.',
  '小提示：搜索框支持自然语言，例如「上个月用 50mm 拍的照片」；悬停照片卡片可快速预览大图与参数；进入影集后可拖拽调整顺序。':'Tip: search understands natural language like "50mm shots from last month"; hover a card to preview; drag to reorder inside albums.',
};
export function getLang():Lang{return localStorage.getItem(KEY)==='en'?'en':'zh'}
export function setStoredLang(lang:Lang){try{localStorage.setItem(KEY,lang)}catch{}}
export function t(text:string):string{return getLang()==='en'?(EN[text]??text):text}
