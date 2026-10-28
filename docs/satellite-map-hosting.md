# 全球离线卫星底图与按需在线地图

Windows WebView2 与浏览器版本复用同一地图组件。默认全球卫星概览使用随应用分发的 NASA 地图数据；选择 Google 卫星并填写浏览器 Key 后，才加载 Maps JavaScript API。应用自己的缩略图、图库句柄、文件路径和地点编辑保留在父页面；Google 地图桥接只传地图坐标、视窗及投影位置。

## 全球离线数据

数据来自 [NASA Blue Marble: Next Generation 的地形明暗版本](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/)，采用 2004 年 7 月、21600 × 10800 像素的全球合成影像，NASA 标称约 2 km/像素。保留 `NASA Earth Observatory` 信用；原始 URL、摘要、使用条件和转换方法见两份 `public/licenses/nasa-blue-marble.json`。这是历史全球概览，不提供实时、街道级或导航精度。

两端 `public/maps/earth/` 完全相同。地图使用等距圆柱投影（EPSG:4326），西北角为原点；z0 至 z4 分别为 2 × 1、4 × 2、8 × 4、16 × 8、32 × 16 个 512 像素 JPEG 瓦片，共 682 张。另有 2048 × 1024 的 `globe.jpg`、`metadata.json` 和标准 `SHA256SUMS.txt`，合计 685 个文件、15,363,147 字节。最高层分辨率为 16384 × 8192，不能通过继续放大获得源数据不存在的细节。

Windows 安装包直接包含全部地图资源。两份 Vite 的浏览器构建按 `metadata.files` 生成完整 precache，同时包含 metadata、摘要文件与来源许可证；缓存清单只接收受约束的本地路径，NASA 原图 URL 和 Google 网络资源不进入缓存。每个瓦片、纹理及来源记录的真实字节都参与 service worker 版本摘要，因此修改文件会触发缓存更新。

浏览器必须等待该版本 service worker 的完整 `install` 成功，之后全球范围均可离线，包括从未浏览过的区域。注册成功或已显示部分瓦片不代表完整缓存就绪；初次可通过 `navigator.serviceWorker.ready` 等待，更新则观察新 worker 的安装和激活状态。任一下载失败会拒绝安装，原有活动 worker 不被半成品替换。浏览器清理站点存储后需要重新完成缓存。

两个网站打包脚本从仓库中的 metadata 读取地图白名单，另外只接纳三个 Google 桥接文件、原有陆地底图、metadata、摘要与 NASA 信用记录，以及 Leaflet 许可和来源记录，共 692 个指定资源。逐文件比较构建结果和仓库来源；缺失瓦片、缺失信用、额外地图文件或被替换的内容都会阻止打包，构建输出不能通过修改自己的 metadata 扩展白名单。

## Leaflet 区域瓦片

离线 NASA 图层使用 EPSG:4326，在线 ArcGIS／MapTiler 图层使用 EPSG:3857。Leaflet 1.9.4 及 BSD 许可随包提供。两种投影切换时重新建立地图实例，并使用已有画面过渡；照片经纬度一直保持 WGS‑84。只允许固定供应商域名的瓦片和元数据，不接受任意外部 URL。API Key 由所有者在当前浏览器设置中提供，不写入仓库或静态产物。

## Google 独立文档

父页面继续使用 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`，保留 RAW / WASM 使用的跨来源隔离。父页 CSP 使用 `frame-src 'self'`，不允许 Google 脚本或 Google 地图网络请求。Leaflet 在本地构建为按需代码块，父页图片和连接权限仅额外允许 `https://ibasemaps-api.arcgis.com` 与 `https://api.maptiler.com`；远端图片使用匿名 CORS，元数据使用省略凭据的请求，不放宽脚本权限或 COEP。

仅下列三个公开文件使用专属响应头：

- `/maps/satellite.html`
- `/maps/satellite.js`
- `/maps/satellite.css`

它们使用 `Cross-Origin-Embedder-Policy: unsafe-none`、`X-Frame-Options: SAMEORIGIN`、`frame-ancestors 'self'` 和 `Referrer-Policy: strict-origin-when-cross-origin`。HTML 以 `credentialless` iframe 加载，sandbox 不包含 `allow-same-origin`。必须先设置 credentialless，再设置 src，避免首次导航携带父页面凭据或被父页 COEP 阻挡。

地图文档的 CSP 只列出 Google Maps 官方文档中的必要精确域名：SDK 的 maps.googleapis.com / maps.gstatic.com、地图资源与 khm / khms 卫星图片域名、字体及 csi 静态遥测域名。不使用所有 HTTPS、通配 Google API 域名或本机 API 的 connect-src 权限。Google SDK 所需的 eval 权限只存在于此沙箱文档，不扩展至父页面。线上服务域名可能变化；新增来源需要结合真实 SDK 请求单独核对。

Windows 服务的规则在 `backend/app/main.py`；独立静态站与根目录浏览器包分别使用 `web/edgeone.json` 与 `edgeone.json`。同一响应头不能同时保留冲突值，例如 require-corp 与 unsafe-none；托管平台必须以三个精确路径规则覆盖默认规则。两份 Vite 开发配置直接返回该静态文档，避免注入不属于地图沙箱的 HMR 脚本。

## 离线缓存与凭据

三个公开桥接文件加入 service worker precache，文件内容及托管响应头参与缓存版本摘要。Google SDK、ArcGIS／MapTiler 瓦片和其他外部请求不进入应用 service worker 缓存。API Key 不写入静态 HTML、JavaScript、URL 查询参数、构建清单或 Git；运行时通过带随机通道标识的 postMessage 传给地图 iframe。Google 自身 SDK 请求仍会按其协议携带 Key。

正式使用需要启用 Maps JavaScript API 与结算，并限制 Key 的 API 和网站来源。Windows 使用实际回环 HTTP 来源；网站使用 photomanagement.online。标准 Key 和 Demo Key 的权限不同，官方 Demo Key 仅供原型验证。Key 在客户端使用，不应被当作不可见的服务器密钥。

## 验证边界

- 后端回归比较三个特殊路径与两份托管配置，确认相邻地图路径和 API 保留原始隔离策略。
- Node 回归启动本机 Vite 检查实际 HTTP 响应、静态文档未被改写；调用真实构建钩子后执行生成的 service worker，检查完整全球数据 precache、文件内容变化使缓存版本变化、非法路径被拒绝、下载失败使安装失败，以及外部请求不被拦截。
- 浏览器回归需在真实 sandbox iframe 中 mock Google SDK，检查无父凭据、无法读取父存储、父页面仍保持 crossOriginIsolated，以及坐标投影和照片预览。
- mock 只能验证桥接和界面。真正的卫星图、Key 的域名限制、网络可达性与 Google 服务授权必须用所有者提供的有效 Key 另行验收。

## 参考

- [Google Maps JavaScript 加载](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)
- [Google Maps 域名列表](https://developers.google.com/maps/domains)
- [Google Maps CSP](https://developers.google.com/maps/documentation/javascript/content-security-policy)
- [Chrome credentialless iframe](https://developer.chrome.com/blog/iframe-credentialless/)
- [Maps JavaScript API Key 与 Demo Key](https://developers.google.com/maps/documentation/javascript/get-api-key)

2026-10-28 核对。旧版卫星 45° 影像已于 2026 年 5 月停用，本实现不依赖旧式 setTilt(45)；参见 [Google 地图类型](https://developers.google.com/maps/documentation/javascript/maptypes)。
