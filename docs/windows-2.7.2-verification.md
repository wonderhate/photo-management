# Windows 2.7.2 与网站更新 · 2026-10-28

本次新增六套拼图预设、NASA 全球离线卫星与可旋转地球、照片聚合悬停预览、Leaflet 按视窗瓦片加载、可选 ArcGIS／MapTiler／Google 接入，并删除公开网站顶部“光影集”导航项。网页与 Windows 同步，保留全站 1/3 指针光照和跳过图库／导入再提示。

## 已完成的检查

基线与新增地图功能分别回归；新增地图最终以真实 Leaflet 渲染和冻结 Windows 程序验收。

- 后端完整回归：463 通过、3 跳过；图标 1 通过。
- 原生逻辑：247 通过；独立网站逻辑：257 通过（含全部 683 张影像的尺寸和 SHA 校验，以及托管响应头限制）。
- [GitHub 完整 Checks](https://github.com/wonderhate/photo-management/actions/runs/40677807298) 全部通过：原生 UI 249 通过、1 个可选真实模型检查跳过（未提供 `PHOTO_TEST_VISION_MODELS`），包含四种 RAW 测试素材校验；CI 后端 458 通过、16 跳过。CI 与本机基线的依赖环境不同，分别记录结果。
- 网页拼图 26 个独立用例已覆盖通过，含六套预设的实际 PNG、恢复、批量余图、撤销和原图哈希。
- Google 接入使用实际隔离框架和模拟 SDK，中文／英文、照片投影、悬停展开、错误重试、Key 替换／移除、无父 Cookie 与跨源隔离检查通过。
- 网页真实 NASA 底图的中文／英文、纹理、分级缩放、国家筛选，以及完全断网后读取未访问区域的底图和原片哈希检查通过。

- 最终 Leaflet 自动高清专项覆盖两种投影、分数缩放阈值、单世界铺满、国家与城市定位、反经线、减少动画、超时回退、暂停自动重试、主动重试、服务切换与原图哈希；网页及原生双语／宽窄屏通过。
- 展示、下载、全站液态玻璃与图库延后选择 18 项浏览器回归通过。Vite 更新为 7.3.7，双端依赖审计无已知漏洞。
- 最终正式网站生产包 7 项验收一次通过：中英文、宽窄屏、公开路由、下载、跳过图库与导入提示、无 Key 的 NASA 零外联。保留全部 18 张授权照片，35 张引用 JPEG 与来源逐字节一致，42 个授权源文件 SHA 不变。
- 网站打包测试补齐 Leaflet 两份许可样本，并验证删除／篡改均会被拒绝；相关 4 项通过。托管策略修复后的 [Checks 40682057688](https://github.com/wonderhate/photo-management/actions/runs/40682057688) 中，网站 257 项逻辑、构建与 Windows 脚本语法检查均通过。

## 发行检查

Windows 构建、安装器编译、7020 项资源／隐私／许可审核、ZIP 完整性、冻结程序功能、六个实际 WebView2 路由与 NASA Leaflet 地图验收全部通过。实际地图已加载瓦片、按国家聚焦并显示照片；合成原图 SHA 不变。Build ID：`e86e1c67b80ad64e`。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| PhotoCollection-Setup-2.7.2-x64.exe | 290169347 | bfc392022af17cec5440b1aa368d3086febf0fbe155f64af4eb5b9140e3de274 |
| PhotoCollection-Windows-2.7.2.zip | 327540988 | d2ba353721fef6d63e5890ba7ca7775ffffce823460a2a9e3e20d40430527018 |

## 发布与正式域名验收

- 代码通过 [PR #6](https://github.com/wonderhate/photo-management/pull/6) 整合；[v2.7.2](https://github.com/wonderhate/photo-management/releases/tag/v2.7.2) 公开试用发行包含安装器、ZIP 与版本校验清单，标签对应提交 `ef271f2807bc460bb7fa257cc6e6929e13cdd695`。GitHub 资产、下载服务器原始文件及实际服务卷的完整 SHA-256 均与上表一致。
- [正式网站](https://photomanagement.online/) 与 [下载页](https://photomanagement.online/windows.html) 已更新。最终部署 `dpn5v3u6otdr`，网站 ZIP 为 46609484 字节，SHA-256 为 `8475c697ea1cd100bf257df61b9660a1606955495a798852619bed9be51b2c40`。
- 正式域名的中英／宽窄屏浏览器验收 7 项通过：公开路由、原有作品及灯箱、旧锚点、导航与入口、下载信息、跳过图库及导入提示、NASA 纹理和瓦片。使用全新浏览器上下文，未选择真实图库；既有公开页访问计数请求保持阻断，不将其作为新增外联。
- 最终部署 HTTP 验收 764 项一次全通过：757 个网站资源的 SHA／长度／MIME／安全头，4 个新旧 Windows 文件的 HEAD 与首末 64 字节 Range 206、2 份版本校验清单以及中转健康检查。全部 683 张 NASA 影像、18 张作品清单和 35 个引用 JPEG 保持一致；旧下载与中转路由继续可用。
- [PR #7](https://github.com/wonderhate/photo-management/pull/7) 修复 EdgeOne 对超过 1000 字符响应头值的限制：三个 Google 隔离页面策略从 1316 压缩为 993 字符。HTTPS 下精确来源和指令集合保持一致，主页面策略未放宽。部署仅改变 `edgeone.json` 与 `sw.js` 缓存版本，其余 869 个文件逐字节不变；不涉及 Windows 发行文件。
- 最终正式域名的 Google 隔离框架专项 1 项通过：浏览器实际获取三份 993 字符策略并加载本地模拟 SDK，完成就绪、模拟点投影与标签；主页面 `crossOriginIsolated=true`，隔离框架不能访问父页面／本地存储，实际请求未携带父 Cookie。未请求真实地图服务，没有页面／CSP 错误、Key 泄漏或目录选择。

托管策略回归包含后端 9 项与独立网站 5 项检查，三条真实线上策略已逐字完整匹配。省略来源中的重复方案名仅在受保护文档为 HTTPS 时等价；网页开发预览的 HTTP 环境仍限制同一组精确主机，但不宣称 HTTPS 方案等价。Windows 回环 HTTP 服务继续使用显式 HTTPS 来源。平台限制见 [EdgeOne 配置文档](https://pages.edgeone.ai/document/edgeone-json)，匹配规则见 [CSP3](https://www.w3.org/TR/CSP3/#match-url-to-source-expression)。

## 验收边界

ArcGIS、MapTiler、Google 均无实际所有者 Key；自动高清切换以官方接口的模拟响应验证，不能视为实际账户授权或高清影像网络验收。默认离线底图不需要 Key。没有访问私人照片或调用付费服务。覆盖安装、跨版本升级与卸载继续按原计划保留验收，未覆盖现有注册安装。旧 AfterFrame 计划仍为 97 项已验收、2 项待安装验收。
