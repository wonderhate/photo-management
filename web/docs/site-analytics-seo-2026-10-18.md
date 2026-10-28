# 页面级统计与搜索结构化数据

日期：2026-10-18。网页版版本：2.6.1（未改动）。本次只改公开站的统计与搜索元数据，未部署、未发布作品、未改动 Windows 下载文件与图片。

## 改了什么

- 新增 `frontend/public/pageview.js`：第一方页面浏览打点。仅在 `*.photomanagement.online` 域名下触发，`?local=1` 与 `#/` 引用应用内部路由，不计数；一次加载一张 `img` 请求，无 Cookie、无用户标识、无第三方。地址为 `https://ai.photomanagement.online/hit?p=<路径>`。
- `index.html`、`windows.html`、`public-pages.mjs` 生成页都引入该脚本；静态介绍页同时保留原 `site-notes.js`。
- `edgeone.json`：CSP `img-src` 增加 `https://ai.photomanagement.online`，其余指令不变。该来源只用于打点，不接收任何页面数据。
- `windows.html`：补 canonical、`og:*`、`twitter:card` 与 `SoftwareApplication` JSON-LD（名称、系统要求、版本、免费、下载地址、开源许可）。
- `public-pages.mjs`：`about` 页输出 `Person`，`lumina` 页输出 `SoftwareApplication`，首页输出 `WebSite`；JSON-LD 中的 `<` 统一转义为 `\u003c`。
- `site-notes.js` 顶部注释改为“无第三方请求”，与现状一致。

## 计数口径与边界

- `/hit` 由新加坡 Caddy 直接返回 204，只写一行访问日志（路径 + 时间），不落库、不设 Cookie。
- 因此 PV 与 Windows 下载次数取自同一份 access log，按 Asia/Shanghai 日切分。日志按 20 MiB × 5 轮转，轮转后更早的明细会被覆盖。
- 本地回环、预览与测试域名不触发打点，开发与回归不会被污染。
- 这是 PV 计数，不是独立访客：UV 需要额外的标识，本次不做。

## 验证

- `npm test`：16 项通过（含公开页生成与开发预览 CSP 两项）。
- `npm run build`：通过，`dist-showcase` 生成 18 张作品的公开包。
- 生产构建预览（127.0.0.1:4176）用 Chrome 无头核对 `/`、`/windows.html`、`/about/`、`/lumina/`：均 200、均含 JSON-LD 与打点脚本、选择器可见、控制台零报错。
- 服务器侧：Caddy 增加 `@beacon path /hit → 204` 路由，`caddy validate` 通过并热更新；探测返回 204 且日志出现 `204 /hit?p=/windows.html`。
- `stats.py --selftest`：日志解析跨零点分日、下载与浏览分离通过。

## 未完成

## 发布

所有者点过「发布到正式网站」但失败：`package-showcase.py` 的公开文件白名单没有 `pageview.js`，打包报 `Unexpected public artifact: pageview.js`，发布服务把它显示成「核对 Token、网络和项目权限」。已把 `pageview.js` 加入白名单，并让发布失败时带出真实错误名与摘要（仍不含 Token）。

修复后重新构建并打包 `releases/Lumina-Web-20261018T055800073400Z/browser-static.zip`（26.9 MiB），部署编号 `dplvjtczhdqg`，状态 Success，正式域名 `index.html` 与本地构建 SHA-256 一致。

线上核对：`/`、`/windows.html`、`/about/` 均 200，都带 JSON-LD 与打点脚本；`/windows.html` 有 canonical、`og:*`；CSP 的 `img-src` 含打点来源。

## 打点的一个真实缺陷（已修）

首版 `/hit` 直接返回 204。但站点带 `Cross-Origin-Embedder-Policy: require-corp`，跨域图片必须自带 `Cross-Origin-Resource-Policy`，否则会被浏览器拦掉；204 也不是有效图片。

现在 `/hit` 改为返回 1×1 透明 GIF（`lumina-downloads/hit.gif`），带 `Cross-Origin-Resource-Policy: cross-origin`、`Cache-Control: no-store`、`Content-Type: image/gif`，实测响应头正确，日志照常记录 `/hit?p=...`。

本机 Chrome 走系统代理（127.0.0.1:7892），该代理对 `ai.photomanagement.online` 直接断连，所以浏览器内的端到端验证没能在本机完成；服务端行为已用 curl 逐项核对。真实访客需要一次页面加载后在访问日志里确认。

## 未完成

- 本机浏览器端的端到端打点确认（受本机代理影响），建议在真实网络下打开一次站点后看当日 PV 是否 +1。
- 截图与 GIF 尚未补；站点当前用作品照片与图标，桌面界面截图需实际运行 Windows 版后获取。
- 页面里的 `v1.0` 展示版本按所有者此前确认保留，未改动。
