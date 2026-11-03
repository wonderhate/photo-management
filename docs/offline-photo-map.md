# 离线地球与照片地图

Windows 与网页版共用同一套地点界面。默认显示可旋转地球，展开后使用随应用提供的 NASA 全球卫星概览，不需要 Key。现在支持独立安装 **区域高清离线 PMTiles 地图包**，放大自动读取已安装地区的高清影像；超出覆盖范围、缺少瓦片或缩回全球时显示 NASA 概览。默认不连接外部地图 API，即使之前保存过服务 Key 也不会自动联网。

## 区域高清离线包

在「拍摄地点 → 离线地图包」选择 `.pmtiles` 文件。应用复制到当前设备／浏览器配置的独立地图存储，不放进照片库，不修改原地图文件。支持启停、查看地区、来源与许可、确认后移除。重叠地区优先显示最近安装的包。只有当前视野所需的索引和瓦片进入内存，不一次读取整个文件；最多四个瓦片任务同时进行，图像缓存有上限。

地图包采用 PMTiles v3、EPSG:3857 栅格 JPEG／PNG／WebP，支持无压缩或 gzip；需要有效的范围、缩放级别、`name`、`attribution`、`license` 元数据。拒绝矢量、未知压缩、不合法索引范围和缺失来源。归档中的 URL 只作为文字，不会成为网络请求。地图内部将区域瓦片重投影到现有 EPSG:4326 网格，切换覆盖边界时不更换相机和照片坐标，保留飞行、悬停预览与减少动态效果。

区域包独立于 service worker 的轻量全球底图缓存，不在首次打开时自动下载，也不随网站或 Windows 主程序打包。安装使用原子事务；取消、空间不足和写入失败不会留下可见的半个包。损坏或缺失的包显示说明并回退概览。清除站点／应用 WebView 数据会移除已安装副本；原 `.pmtiles` 应另行保留。网页网址、浏览器配置和 Windows 使用各自的本机地图存储，需要分别安装。

### 制作地图包（开发／发布电脑）

采用 ESA WorldCover **2021 RGBNIR 年度合成**，原生约 10 米，CC BY 4.0。这是真彩色影像，不是土地覆盖分类图，也不是实时影像。实际 GeoTIFF 的波段标签指定 1/2/3 为红／绿／蓝；构建工具先检查标签，不能从通用产品摘要猜测波段顺序。使用固定反射率拉伸与 gamma，避免逐瓦片调色造成接缝，保留透明无数据区域。

构建工具只在制作时通过公开 AWS COG 的 HTTPS 范围请求下载所选地区，不需要 AWS 账户，不抓取 Google／ArcGIS 瓦片。运行应用时只读取完成的本地包。工具的地理依赖不进入 Windows 安装器和网页运行时。

```powershell
python -m venv .local-notes/map-tooling
.local-notes/map-tooling/Scripts/python.exe -m pip install -r frontend/scripts/map-pack-requirements.txt
.local-notes/map-tooling/Scripts/python.exe frontend/scripts/build-offline-map-pack.py --bbox 110.15 24.7 110.65 25.4 --name "桂林与漓江 · Guilin & Li River" --output .local-notes/offline-maps/guilin-lijiang-2021.pmtiles
```

输出单文件地图包、预览 JPEG、来源／范围／处理参数／许可／SHA-256 JSON。构建中间文件在同目录 `.work` 子目录；完整 RGB 裁切完成后可复用。默认生成 z6–14；继续放大只显示既有分辨率，不会伪造高清。10 米数据适合地形、海岸和城市轮廓，不能分辨单栋建筑细节。区域限制为最多 4 平方度，优先分地区制作，避免直接下载全球数 TB 影像。输出已存在时拒绝覆盖。

数据：[ESA 产品说明](https://esa-worldcover.org/en/data-access)、[AWS RGBNIR 数据与许可](https://registry.opendata.aws/esa-worldcover-vito-composites/)。归档读取：[PMTiles FileSource](https://pmtiles.io/typedoc/classes/FileSource.html)。PMTiles 和 fflate 的许可与来源记录随两端程序提供。

### 中国区域整套 10 米包

`frontend/scripts/build-china-map-packs.py` 将全国覆盖任务拆成独立源格网，生成 z6–14 的 WebP PMTiles，再按 5° 网格合并为可独立安装的地区包。合并会组合相邻源块的透明边缘，避免共用瓦片丢掉一侧。输出单包限制为 8 GiB；源影像、临时瓦片和结果均使用指定输出盘，支持 1、2 或 4 个任务同时处理。磁盘剩余不足 30 GiB 时停止，已完成文件保留。

```powershell
.local-notes/map-tooling/Scripts/python.exe frontend/scripts/build-china-map-packs.py --output .local-notes/offline-maps/china-2021 --plan
.local-notes/map-tooling/Scripts/python.exe -u frontend/scripts/build-china-map-packs.py --output .local-notes/offline-maps/china-2021 --workers 1
.local-notes/map-tooling/Scripts/python.exe frontend/scripts/build-china-map-packs.py --output .local-notes/offline-maps/china-2021 --status
```

默认使用一个制作进程；完整浏览器回归、Windows 打包与地图制作应串行运行，避免超过系统内存提交上限。资源充足且不运行其他大型任务时可先测量 `--workers 2` 的内存峰值和吞吐量，再考虑 `--workers 4`。增加任务数不保证线性加速，需持续观察系统可用内存、提交余量与磁盘空间。

准备清单不下载全分辨率影像。实际构建使用带 ETag 校验的 16 MiB HTTP 范围续传；完成一格后校验 PMTiles SHA-256，再清理该格生成的 RGB 中间文件和源影像缓存。再次运行会验证并复用已完成分区与源格网，未完成下载继续读取剩余字节。运行锁避免两个进程同时写同一目录。可在输出目录创建名为 `STOP` 的空文件，让任务在当前源块完成后停止；删除此文件后用同一命令继续。异常退出留下的锁仅在对应进程已不存在时清理。

每个格网使用独立的持久 HTTPS 会话复用连接，沿用系统代理与证书验证。每段检查 206、Content-Range、ETag、响应长度和无压缩传输，拒绝重定向；中断后保留已核实来源的字节并在有界重试中继续。制作进程在加载 NumPy 前将 OpenBLAS／OpenMP／MKL 内部线程限定为 1，减少多格网并行时的额外内存开销；不改变系统环境、影像分辨率、色彩和编码参数。下载回归使用合成数据与回环 HTTP 服务，可运行 `python frontend/scripts/test-map-download.py`。

代理或 TLS 在持久连接上报错时，当前格网的后续有界重试回退到非复用连接，继续沿用系统代理、证书验证及上述分段校验，不重复下载已接收的有效前缀。来源／协议不匹配会直接拒绝，不通过换传输方式绕过；无法恢复的格网记录为失败，成品和部分下载保留。

Windows 制作时还会在 RGB 行块和每张瓦片处理前检查系统可用物理内存与提交余量。低于 2 GiB 时保留检查点并等待，恢复后继续原任务，不改变像素或并行设置；连续 15 分钟不足则有界退出，保留源文件和可复用的 RGB 裁切。该检查不能保证其他应用突然大量分配内存时绝不失败。回归命令：`python frontend/scripts/test-map-memory.py`。

2026-10-30 的清单包含 1,167 个可用源格网，分为 70 个地区包；完整源对象合计约 643.4 GiB，这是累计下载量，不是成品大小，也不会全部留盘。覆盖选择包含中国大陆、港澳台、南海岛屿补充窗口与边缘缓冲。Natural Earth 的公有领域几何只用于选下载格网，不绘制行政或国界线；边缘格网包含相邻地区影像。范围记录与数据来源保存在 `plan.json`。

**覆盖清单不代表全部已经制成。** `status.json` 记录完成和失败数量，`logs/` 记录每格下载与切片进度；缺失源对象另列于 `plan.json` 的 `unavailable_cells`。WorldCover 在少数岛礁缺少影像，例如永暑礁所在格网；不得将这些区域标为 10 米覆盖，应用继续显示全球概览。所有影像为 2021 年数据。

安装时可一次选择多个完成的 `.pmtiles` 文件，逐个保存。取消或某个文件失败会停止后续安装，已完成地图包保留，当前文件仍使用原子写入。原始包不变，网页与 Windows 各自安装；不会自动发布到网站、放入安装器或上传照片。

## 浏览

- 地球可拖动或用方向键旋转，支持暂停；开启系统减少动态效果时停止自动旋转。
- 离线卫星支持拖动、滚轮、双击、方向键和缩放按钮。点击聚合照片点平滑放大，悬停或键盘聚焦展开最多六张本机照片，点击可进入现有浏览器。
- 国家与城市沿用图库中的人工地点名称；国家胶囊会筛选照片并调整地图范围。无坐标照片仍可从单独入口浏览，在照片详情里填写地点。
- 照片缩略图、聚合与地点编辑留在本机。原图和原始 EXIF 不改写，也不自动调用在线地理编码。

## 为照片在地图上选点

在「照片信息 → 拍摄地点」点击「在地图上选点」。点击地图放置标记，拖动标记微调；也可以用方向键平移地图，再点击「使用地图中心」。已有坐标会显示为标记；没有坐标时不会自动赋予默认位置。支持跳转到已安装的离线地区、回到标记和全球概览。

点击「使用此位置」仅将经纬度填回编辑表单，最后点击「保存地点」才写入图库记录。取消或按 Escape 不改变表单；原来的国家、城市和地点名称保留，不自动联网查询地址。选点地图只使用 NASA 概览与已启用的本机高清包。原始照片、GPS 和 EXIF 不改写。

## 底图与离线缓存

影像为 NASA Blue Marble Next Generation 2004 年 7 月全球合成，带地形背景。源图 21600×10800，标称约 2 km/像素；应用处理为最高 16384×8192（赤道约 2.45 km/像素）的五级图像金字塔，覆盖全球。它用于世界与地区概览，不能显示当前街道或单栋建筑。

682 张 512×512 JPEG 加一张地球纹理，共 15,185,583 字节。元数据、全文件 SHA 与来源记录包含在发行包中。Leaflet 1.9.4 按视窗加载所需层级，并保留相邻瓦片缓冲，跨越日期变更线时连续显示。离线层使用 EPSG:4326；图片按 256 CSS 像素展示，最高原生层级为 4，继续放大只放大已有影像。

Windows 将底图随安装包提供。网页版首次联网时，service worker 下载完整底图和本地应用资源；完整缓存成功后可断网重新打开并查看未曾浏览过的区域。浏览器清理站点数据会移除缓存，此时需要重新联网下载。离线地图不会向地图供应商发请求；可选在线模式使用所选服务的接口。

## 可选联网高清（默认关闭）

原有 ArcGIS World Imagery／MapTiler 接入仍在进阶设置中保留。必须主动勾选「本次允许联网高清」，且没有启用区域离线包，并提供自己的有效 Key，才会自动使用联网高清；刷新后恢复默认关闭。没有覆盖的地区优先提示安装离线包，不要求 Key。在线影像需要网络、相应账户授权，并可能按使用量计费。没有附带参考站的凭据，也不使用未核实授权的免 Key 瓦片地址。

在线层使用 EPSG:3857，照片 GPS 始终保持 WGS‑84，不转换或回写原图 EXIF。当前不连接高德，因而不混入 GCJ‑02 坐标；后续接入高德需要自己的官方 Key 与安全配置，并单独处理显示坐标转换。

离线缩放超过原生 z4 时自动进入在线层（投影换算后超过在线 z5），在线缩回 z5 或以下时回到离线 z4 或以下，避免边界反复切换。切换地点或底图时保留已加载的旧画面，新瓦片就绪后淡出；等待设有上限，高清失败自动退回内置离线概览，并暂停自动重试；用户可显式重试，或缩回概览后再次放大。飞行过渡约 0.6 秒，系统减少动态效果会关闭飞行与淡入。地图移动只请求视窗所需瓦片，不批量下载在线影像，也不把供应商图片加入应用离线缓存。

Key 仅存于当前浏览器配置；照片、缩略图、文件路径和图库句柄不发给地图供应商。瓦片请求会向对应服务透露当前浏览的地图区域，和照片内容上传是不同的处理。账户权限、来源限制及实际影像可达性需使用所有者的有效 Key 验证；自动检查只使用合成瓦片和模拟授权响应。

## 可选 Google 模式

在“地图设置”输入启用了 Maps JavaScript API 的浏览器 Key。标准 Key 需要启用结算，限制 API 与授权网站来源。Key 保存于当前设备的浏览器配置，不随图库或设置包导出；可随时移除。网站和 Windows 的回环来源需分别配置。

Google SDK 在无同源权限的 credentialless iframe 中运行，主界面继续保持跨源隔离。详情见 [地图托管说明](satellite-map-hosting.md)。当前没有真实 Google Key；接口和隔离使用模拟 SDK 验证，实际卫星访问需用户自行配置后检验。Google 影像不下载为离线地图。

## 来源

- [NASA Blue Marble + Topography](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/)；制作：Reto Stöckli / NASA Earth Observatory。
- [NASA 影像使用说明](https://www.nasa.gov/nasa-brand-center/images-and-media/)；无 NASA 标识或背书。
- 本机完整来源记录：`frontend/public/licenses/nasa-blue-marble.json`。
- 交互结构参考 [向往坐标](https://cn.chuweimin.com/spot-gallery)，未复制其地图瓦片、照片或凭据。
