# 光影集 / Lumina Web

独立管理浏览器本地图库、公开摄影展示和光影暗房。正式源码随主项目保存在 GitHub 的 `web/` 目录，桌面代码位于仓库根目录。本地独立检出保留原有历史。正式网站为 https://photomanagement.online/，通过现有作者发布器，在所有者授权后更新。

## 包含内容

- 本地图库：首页策展、照片和影集、搜索筛选、沉浸浏览、水印及导出。
- 光影暗房：照片分析、参考图仿色、RAW 解码和后期编辑。
- 公开作品站：显式选片导出，独立构建公开展示包；不自动包含本机照片。
- 可选 AI 中转：标题建议、水彩生成、会话密钥和逐次确认。标题语言跟随界面。
- 字体、品牌图案、依赖许可和浏览器回归测试。

`frontend/src` 保留复用的界面组件；所有默认构建入口均为浏览器模式。`cloud_relay` 及 `assets` 已移除对原桌面仓库的路径依赖。

2.7.1 整合版已于 2026-10-28 上线，接入“改版”的新版浏览器光影集，同时保留原网站的作品展示、介绍、下载和作者发布逻辑。全站指针柔光缩为原半径的 1/3，图库选择可跳过并在导入时继续。整合范围、构建兼容和验证记录见 [官网与新版光影集整合](docs/website-lumina-integration.md)。

## 安装和启动

需要 Node.js 22.12+、桌面 Chrome/Edge。AI 中转需要 Python 3.12+；普通本地照片处理不依赖 Python。

```powershell
npm run setup
npm run build
```

预览作品首页（不启动 AI 中转）：

```powershell
node frontend/tests/web-server.mjs
```

在 Edge 或 Chrome 打开 `http://127.0.0.1:4175/`，默认进入作品展示。顶部提示可直接滚动到页底；页底“进入光影集”打开本地图库和创作工具；公开站不提供作品更新入口。开发模式运行 `npm run dev`，端口为 5175，同样先展示作品。

本地图库直接地址为 `http://127.0.0.1:4175/?local=1#/`。原片和图库数据目录单独授权；不同浏览器、配置和网址不共享授权记录。作者运行 `npm run author` 打开本机专用作品发布页。原有图库选片导出通道仍可用：运行 `npm run author:library`，访问 `http://127.0.0.1:4177/?local=1#/?publish=1`。这两个作者通道均不作为公开站点部署。

启动页可选择“跳过，先浏览”，先查看空白摄影空间和各个功能界面。跳过不会创建图库或申请目录权限；点击“导入照片”时会重新提示新建或打开本地图库，完成后直接继续导入。取消选库仍可浏览。需要保存的操作和暗房打开照片也会先要求选择图库；已有图库的自动恢复和重新授权方式不变。

如需本地 AI 中转，先配置 Python 环境：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r cloud_relay/requirements.txt
npm run preview
```

`npm run preview` 同时运行 4175 网页预览和 9000 回环 AI 中转；不会自动调用付费 API。API Key 在网页中填写，仅存于当前页面内存，刷新后须重新填写。模型账户权限以实际请求为准。Linux 环境使用 `.venv/bin/python` 安装依赖。

## 验证

```powershell
npm test
npm run build
npm run build:web
$env:PHOTO_TEST_PYTHON=(Resolve-Path '.venv/Scripts/python.exe').Path
npm run test:web
.venv/Scripts/python.exe -m unittest cloud_relay.test_relay
npm run build:showcase
```

浏览器测试使用独立的 4185 / 4186 端口，不占用日常预览的 4175 / 4176。测试需要 Chrome，或在 CI 中安装 Playwright Chromium；`npm run test:relay` 需要先激活 Python 虚拟环境，也可使用上面的直接调用方式。真实 RAW 样本可用 `npm run test:web:fixtures` 下载；来源和校验值见 `frontend/tests/raw-fixtures.json`。样本、截图、日志和合成测试图库都留在忽略目录 `.test-artifacts`。

完整网页回归的可选原生元数据对照可通过 `PHOTO_NATIVE_REFERENCE_ROOT` 指向原项目源码；未提供时只跳过这一对照，不影响普通网页功能。中转协议检查包含 `cloud_relay.test_relay` 与 `cloud_relay.test_studio`，均使用模拟服务。新增 AI 创作使用 `/cloud-studio`，日后发布时需同时更新对应中转与 Caddy 配置；本地整合不会改动线上服务。

## 公开作品及部署

双击项目中的 `打开作品发布.cmd`，或在项目根目录运行 `npm run author`。启动程序会在 Edge 打开带随机会话码的本机作者地址（4178 端口）；请使用显示的完整地址。重复启动会直接打开已经运行的同一作者页；服务重新启动时才生成新的会话码。程序通过仅保存在本机 `.runtime/` 下的会话记录核对已有服务，不会关闭占用端口的其他程序。

1. 可直接选择多张 JPEG、PNG、WebP；也可在“首页轮播”点“上传轮播照片”（最多 6 张），在“精选作品”点“上传精选照片”（最多 12 张），或新建影集后点“上传照片到此影集”。三个区域独立选片和排序，也支持加入已上传照片；影集首张照片为封面。编辑公开文字可展开“全部公开照片与文字”。
2. 点击“生成预览与上传包”，再打开“查看本地预览”。原图保持只读，副本长边最多 2560 像素，并去除 EXIF、GPS 和原文件名。RAW 请先从光影暗房导出。
3. 首次在作者页下方填写 **EdgeOne Makers API Token** 并核对项目权限。它与 AI Key 无关。可用 Windows DPAPI 加密保存在当前用户下，或仅保留本次服务会话。
4. 点击“发布到正式网站”，本机完成构建、上传到已有项目 `makers-o7xx3x5jqy77`，等待成功并核对正式域名内容。不会创建新项目、修改 DNS 或重启 AI 中转。

本机草稿和加密凭据位于忽略的 `.local-notes/publisher/`，不进 Git、网站包或浏览器存储。每次构建保留 `releases/Lumina-Web-时间/browser-static.zip` 和 SHA-256 清单。发布超时不表示云端已取消；界面提示失败时先在控制台查看该次部署，勿连续重复提交。回退可在 EdgeOne 控制台选择旧部署，或重新上传已保留的网站 ZIP。

公开网站只提供静态文件，没有写入作品的接口，也没有作者组件；访客进入光影集时只操作其自行授权的本地文件。发布服务仅绑定 `127.0.0.1`，要求随机会话码、精确 Host 与同源请求，防止其他网站借用本机服务写入。请勿将此服务代理到公网。关闭启动窗口即停止作者入口，线上网站继续运行。

原有图库选片导出方式：运行 `npm run author:library`，打开 `http://127.0.0.1:4177/?local=1#/?publish=1` 并授权自己的本地图库。在弹窗中明确选片、排序、填写网站名称和作品说明，导出到独立目录，然后在项目根目录运行：

```powershell
npm run build:showcase -- --content "D:\发布内容\Lumina-public-实际目录"
npm run preview
```

刷新 `http://127.0.0.1:4175/` 即可看到本次选片。成功构建会把导出目录路径记在忽略的 `.local-notes/portfolio-source.json`；之后 `npm run build` 沿用该目录，保留上次发布内容。更新时重新选片导出，运行带新目录的同一命令。请保留选定的导出文件夹；若目录损坏或被删除，构建会报错，不会静默把作品清空。第一次尚未选片时显示空作品页，不会扫描或自动公开本机照片。

公开展示只读取静态 manifest 和展示副本；本机作者页和发布凭据不随公开构建发布。旧导出方式生成的包可手动上传到 EdgeOne 的现有项目；直接上传和一键发布优先使用新的本机作者页。

封面署名为 Wonder。新版作者页分别设置轮播和精选；普通上传默认补足 6 张轮播和 12 张精选，再按需调整。首页每 6.5 秒循环切换所选轮播照片，支持暂停和手动切换；开启减少动态效果时不自动播放。影集可新建、改名、填写介绍、调整影集与照片顺序；移出精选、移出影集或删除影集都保留公开照片。旧版导出清单继续按原来的前 6 张轮播、前 12 张精选方式读取。

默认网站包位于 `frontend/dist-showcase`，包括作品展示、光影集入口和 Windows 下载页；`frontend/dist-web` 保留单独本地图库版本。`npm run preview:showcase` 可在 4176 额外预览同一展示包。线上更新时上传完整 `frontend/dist-showcase` 替换旧站；本地构建不会自动上线。静态托管须保留 `edgeone.json` 所声明的安全响应头和 WASM MIME；部署在域名根路径，使用 HTTPS。

AI 中转可从仓库根目录运行 `docker build -f cloud_relay/Dockerfile -t lumina-relay .`。线上需设置 `PHOTO_RELAY_ORIGIN` 为正式网站来源，提供 WSS，再在网页“AI 服务设置”填写中转地址；也可用 `VITE_ART_RELAY_URL` 提供构建默认值。中转连接需支持较长的模型等待时间。不要将 API Key 放入构建变量、源码或 Git。

## Git 使用

```powershell
git status
git switch -c codex/你的功能名
git add 具体文件
git commit -m "说明本次修改"
```

原项目之后的改动不会自动同步到这里。后续网页版开发应直接在本仓库进行。`.gitignore` 已排除图库、密钥、依赖、构建和测试产物；字体及图标等正式产品资源正常跟踪。

第三方字体与依赖许可证分别位于 `assets` 和 `frontend/public/licenses`。沿用原项目的源码授权状态，本次拆分不新增开源许可证。

## Wonder 的个人介绍与项目实践

网站以摄影作品为主，首页保留作者选片与展示顺序，增加个人介绍、项目入口及 QQ 交流入口。独立页面为 `/about/`、`/lumina/`，英文对应 `/en/about/`、`/en/lumina/`，英文作品首页为 `/en/`。没有公开影集时弱化空入口，既有影集 hash 链接仍可打开。

`npm run build` 在同一发布包生成可直接阅读的中英 HTML、首页静态介绍与精选作品回退、canonical / hreflang / 分享卡片、robots.txt 与 sitemap.xml。查看源代码或关闭 JavaScript 仍能读到介绍；动态灯箱与本地工具仍需要 JavaScript。新页面可以在构建后用日常预览、本机作者服务或 Vite 查看。搜索引擎是否收录需另行在站长平台核对，生成 sitemap 不代表已经收录。

共同介绍文字与摘要在 `frontend/src/browser/public-profile.ts`，独立说明页正文在 `frontend/scripts/public-pages.mjs`。公开名字、QQ 沿用 `windows-release.json` 中的 developer 字段，选片更新继续使用本机作者页。计算机专业只在 Windows 下载页 QQ 上方以次要文字展示，不放在首页或个人页。页面没有新增统计收集、反馈服务器、账号系统或外部推广请求。

项目页如实说明 AI 辅助、技术与功能边界，可用于展示项目经历；不虚构用户量、职业资历、商业合作或效果数据。维护和验收见 `docs/wonder-personal-site-2026-10-17.md`。

## Windows 下载页

侧栏“Windows 版下载”在新窗口打开 `/windows.html`，本地图库引导页和公开作品站页脚也有入口。下载页无需授权图库，支持中英文、浅色主题、窄屏和键盘操作。开发者区展示“欢迎大家参与改进”和 QQ：1706023204。

版本、直链与 GitHub 备用地址、包名、字节数、SHA-256 和开发者信息集中在 `frontend/src/browser/windows-release.json`。更新发布版本时同步更新该文件。安装包由独立 HTTPS 下载目录提供，网页使用原生下载链接；构建包及 Git 仓库无需包含大型二进制文件，构建不依赖桌面仓库。

对外展示 Windows 1.0，实际软件内容沿用正式的 2.6.1 构建。下载文件名为 `PhotoCollection-Setup-1.0-x64.exe` 和 `PhotoCollection-Windows-1.0.zip`，作为同一 GitHub v2.6.1 Release 的下载副本提供；原下载资源保留。两个副本的大小及 SHA-256 与 2.6.1 原包一致，未重新构建或修改内部版本。文件检查不代替桌面应用的运行验收。安装包未签名，页面如实说明。WebView2 首次安装可能需要联网。ZIP 需完整解压并保留 `_internal`；不要混用网页版和桌面版图库数据。

下载按钮默认使用 `https://ai.photomanagement.online/downloads/1.0/`，支持原生断点续传；每个包保留 GitHub 备用下载及发布页入口。现有新加坡服务器共用 20 Mbps / 512 GB 月流量，实际速度与并发、访客网络有关。Service Worker 不缓存安装包。网站托管的静态单文件上限为 25 MB，因此安装包独立维护；发布网页只需正常构建目录。服务器静态目录、配置及验证记录见 `docs/windows-downloads-2026-10-17.md`。下载页本地地址为 `http://127.0.0.1:5175/windows.html`（`npm run dev`）。

页面结构参考个人开发者软件的 [Everything 下载页](https://www.voidtools.com/downloads/)及 [SumatraPDF 下载页](https://www.sumatrapdfreader.org/download-free-pdf-viewer)：并列安装版与 ZIP，明确架构、大小和校验信息；未使用其图片、文案或品牌资源。

Windows 2.7.1 公开试用和线上部署记录见 [新版下载维护](docs/windows-downloads-2026-10-28.md)。Linux 继续提供独立标记的 2.6.1 预览包。
