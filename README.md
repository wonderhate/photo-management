# 光影集 · PhotoCollection

<img src="frontend/public/icon-192.png" width="72" alt="光影集图标">

本地优先的摄影照片管理软件。当前版本 **2.7.0**（公开试用），提供 Windows 桌面应用和本机网页版；默认进入摄影空间。

[![Checks](https://github.com/wonderhate/photo-management/actions/workflows/checks.yml/badge.svg)](https://github.com/wonderhate/photo-management/actions/workflows/checks.yml)
[Windows 2.7.0 公开试用](https://github.com/wonderhate/photo-management/releases/tag/v2.7.0) · [开发交接](docs/development-handoff-2026-10-13.md) · [文档索引](docs/README.md) · [版本记录](CHANGELOG.md)

## 正式网站与浏览器本地图库

纯浏览器构建：用户选择本地图库和原片目录，日常照片处理无需后端。运行 `npm run dev:web` 或 `npm run build:web`；部署及首版功能边界见 [浏览器版实施与部署](docs/browser-local-first.md)。正式网站：[photomanagement.online](https://photomanagement.online/)，网页本地图库与展示页共用入口。

公开作品展示模式已实现：在本地图库首页选择“导出公开作品”，再运行 `npm run build:showcase -- --content "导出文件夹完整路径"`，生成无需访客授权目录的作品网站。见 [选片、公开展示与发布说明](docs/public-showcase.md)。

融合开发分支保留原照片浏览界面，新增精确缩放、拖动、白底校样和自动收合工具，独立多图对比支持可开关的同步缩放与位置对齐。图库、查看器和编辑工坊共用可重绑快捷键与操作菜单，高清显示支持有界持久缓存及桌面 TIFF / HEIF 回退。见 [照片查看](docs/photo-viewer.md)、[多图对比](docs/photo-comparison.md)、[快捷键与菜单](docs/keyboard-commands.md)、[分层高清预览](docs/display-previews.md)；完整融合进度见 [实施记录](docs/afterframe-upgrade.md)。

工具偏好按图库恢复，查看器清晰度 / 固定、对比同步和暗房输出设置分别保存。独立浏览器可[批量导入 RAW](docs/raw-import.md)，浏览优先嵌入预览，编辑仍使用完整 16 位线性源；原片保持只读。

图库增加[稳定评分排序](docs/photo-order.md)，影集页可创建[条件集合](docs/rule-collections.md)：通过 AND / OR / NOT 和未评分等条件自动更新成员，保留原普通、人物及语义影集。新集合适用于桌面与本地网页版；旧库升级先备份。

照片支持[留用 / 排除 / 清除标记与 Shift 前进](docs/photo-flags.md)，可批量整理、筛选和加入条件集合，排除仅记录决定并保留原片。

照片信息增加[人工描述、标签来源与拒绝保护](docs/photo-annotations.md)，支持人工留空、恢复 AI 描述、确认 AI 标签和重新允许已拒绝标签，保留原有标签编辑。

照片筛选支持[多选、排除、关联计数和自定义筛选栏](docs/photo-facets.md)，未评分与零分分别处理，常用项目随图库保存。

从影集、人物或图表进入后的[检索范围](docs/query-scope.md)在清除临时条件、刷新与前后退时保留，按文件的图表入口继续展示实际匹配的文件。

[标签搜索](docs/tag-search.md)按需返回建议并分页浏览；独立网页使用可重建的后台标签索引，人工维护标签优先。

[本地人物模型保护](docs/face-model-spaces.md)按模型来源分别比较身份向量，更新模型保留原人物、确认和影集。[人物整理](docs/person-management.md)支持封面、合并、拆分、错分移出及有冲突保护的撤销；旧人物影集继续作为快照。[批量忽略与恢复](docs/ignored-people.md)保留人工决定，重扫同来源观察不回到错误候选。[实时人物照片](docs/live-person-photos.md)随当前关联更新，原人物影集保持快照，大图翻页限定当前人物。当前为 SQLite schema 21 / browser manifest 17，[连续切图](docs/seamless-split.md)已接入暗房交互、整组保存 / 重开及单片下载；另支持整组选择目录 / 子目录输出，支持分片独立继续编辑及父子工程往返。[自由文字图层](docs/shared-darkroom.md)已接入暗房：样式预设、触控编辑、图层操作与撤销、保存重开、统一预览 / 导出 / 分图；仍使用原有配色与本地授权字体。现已接入纯色 / 多色渐变蒙层、四边覆盖和文字混合排序，保存后可继续撤销与重做。 本地 LUT 样式库提供导入、收藏、Log 提示与人工标识、按图库记忆的显示和强度设置、键盘浏览及按住对比；预览、导出和分图共用调色结果。

照片页新增[全文搜索与描述 / OCR 条件](docs/text-search.md)，本机文字索引可重建，原有本地画面语义搜索继续保留。

照片信息支持[XMP 评分来源与主动刷新](docs/xmp-rating.md)，首次导入可读取外部星级，重扫和刷新保留后续人工评分与清空决定。

影集总览新增[四图封面、日期跨度、最近照片、表格与批量整理](docs/album-overview.md)，优先保留手动封面，删除影集保留原片。

影集列表支持[名称搜索、四种排序、拖拽编排和重命名](docs/album-list.md)。列表设置随图库保存，新建置顶，搜索后调整仍保留隐藏影集，原片与照片成员顺序不变。

融合开发分支新增[导入后本地人物分析](docs/import-face-analysis.md)：默认关闭，可主动开启，仅为以后导入的新增照片排队。使用已准备的本地模型，关闭停止自动任务，模型未就绪时正常导入。

融合开发分支的暗房支持[交互裁框、三分线、比例、自由校正与取景缩放](docs/composition.md)，共用预览 / 输出坐标并继续回放旧配方，原片保持只读。

## 下载与安装

| 文件 | 用途 |
| --- | --- |
| [Windows 安装包](https://github.com/wonderhate/photo-management/releases/download/v2.7.0/PhotoCollection-Setup-2.7.0-x64.exe) | Windows 10 / 11 x64，安装向导、快捷方式和卸载入口 |
| [Windows 便携包](https://github.com/wonderhate/photo-management/releases/download/v2.7.0/PhotoCollection-Windows-2.7.0.zip) | 解压后运行 `PhotoCollection.exe`，保留同目录 `_internal` |
| [SHA-256 校验](https://github.com/wonderhate/photo-management/releases/download/v2.7.0/SHA256SUMS-2.7.0.txt) | 核对下载完整性 |

Windows 包无需 Python 或 Node.js。安装器使用当前用户目录，包含升级和保留数据的卸载逻辑；2.7.0 的覆盖安装、跨版本升级与卸载仍待验收。缺少 WebView2 时会运行经过 Microsoft 签名验证的引导程序。应用本身尚无受信任的代码签名，SHA-256 校验不等同于发布者签名。

当前不提供 Android / iOS 客户端、手机配对或桌面远程访问。历史版本说明仅用于追溯，请使用最新版本。

## 能做什么

- **照片库**：目录与文件导入、内容去重、RAW + JPG 拍摄分组、EXIF、筛选、收藏、评分、颜色圆环、标签与批量整理。
- **摄影空间**：等高照片布局、时间线、器材统计、月报 / 年报 / 镜头报告、照片对比和普通影集。
- **本地智能整理**：Chinese-CLIP 语义搜索和智能影集；OpenCV 人物检测、分组建议、人工确认、创建与打开人物影集。
- **水印工坊**：摄影相框、沉浸光感、EXIF 信息、中文及英文艺术字署名；草稿保存、恢复、复制、状态筛选、逐作品参数批量导出。
- **水彩转绘**：千问 `qwen-image-3.0` / `qwen-image-3.0-pro` 可选；支持单图及最多 100 张批量转绘，可选在全部图片生成后逐张生成 AI 标题；本地纸纹、55% / 85% 留白排版、原图对比、PNG / JPG 导出和水印联动。
- **浏览体验**：明暗主题、中英文、摄影空间启动页、极光背景与全屏胶片列车。窄屏网页使用普通浏览模式。
- **存储设置**：自定义数据库 / 缓存、模型、导出与自动扫描目录，重启后安全迁移照片库。

## 原图与云端边界

原始照片只读。导入登记路径和 SHA-256；删除图库记录、人物、影集、水印草稿或水彩作品均不会删除原图。浏览器上传时会把用户明确选择的文件复制到导入目录；路径导入不会复制原片。

检索、人物分析、统计、水印与排版在本机完成。**水彩生成和标题建议会在用户点击后上传选定照片**，移除 EXIF / GPS，可能产生 API 费用。没有自动计费重试。真实水彩画质仍需配置有效账户后人工验收，模拟测试不能证明主体和构图完全一致。

千问使用设置窗口显示的接口地址和该接口对应的 Key，旧 OpenAI Key 不会复用。详见 [水彩使用说明](docs/watercolor-usage.md)。

## 源码启动

需要 Python 3.12+、Node.js 22.12+；CI 使用 Python 3.12 和 Node.js 24。

```powershell
git clone https://github.com/wonderhate/photo-management.git
cd photo-management
.\start.ps1 -Install
```

打开 <http://127.0.0.1:8000>。后续可双击 `start.cmd` 或运行 `.\start.ps1`。更新代码后运行 `.\start.ps1 -Rebuild -Restart`；`.\stop.ps1` 只停止当前目录管理的服务。

可选本地智能依赖：

```powershell
.\start.ps1 -AI -Restart
.\start.ps1 -Faces -Restart
```

首次需要下载公开模型权重；照片不会因加载这些本地模型而上传。模型下载失败不阻塞普通照片浏览和水印。

Windows PowerShell 阻止脚本时，可对本次启动使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Install
```

## 数据与备份

Windows 默认照片库位于 `%LOCALAPPDATA%\PhotoCollection\data`，模型位于同级 `models`，导出到 Downloads。源码默认使用项目 `data/`。在“设置 → 照片库与存储”修改目录后，关闭其它实例并重启生效。

`library-config.example.json` 是配置示例，私人 `library-config.json` 不提交 Git。数据库备份只包含元数据；完整备份还应包含导入副本、水印预览、水彩作品等派生文件，并单独保存外部原片。千问 DPAPI 凭证与 Windows 用户绑定，换用户或电脑后可能需要重新填写。

[存储与迁移说明](docs/storage-paths.md)包含迁移条件和恢复方法。

## 本机容器版

[GitHub Packages](https://github.com/users/wonderhate/packages/container/package/photo-management)提供网页容器。镜像不包含本地智能模型依赖、Windows 原生选择器或私人数据；水彩凭证通过启动环境变量 `DASHSCOPE_API_KEY` 提供。

从源码构建当前版本：

```powershell
docker build -t photo-management:2.7.0 .
docker run -d --name photo-management -p 127.0.0.1:8000:8000 --mount type=volume,source=photo-management-data,target=/data --mount "type=bind,source=D:\Photos,target=/photos,readonly" photo-management:2.7.0
```

将示例原片目录换成自己的目录；网页导入路径填写容器中的 `/photos`。原片只读挂载，数据卷与原片分离。不要公开服务端口。容器镜像的发布独立于 Windows Release；精确发布状态见 Packages 页面和工作流。

## 开发与验证

```powershell
npm test
npm run test:frontend
npm run build
npm run test:browser
.venv/Scripts/python.exe -m unittest desktop.test_icon
```

Windows 2.7.0 公开试用验收见 [交付验证](docs/windows-2.7.0-verification.md)，正式浏览器网站源码在 `web/`。测试使用合成照片库；付费生图、其它电脑的网络与硬件需要单独验收。

发布构建：

```powershell
# 先准备后端、可选智能依赖和 desktop/requirements.txt
.\build-windows.ps1 -SkipDependencies
.\build-installer.ps1
.venv/Scripts/python.exe desktop/verify_package.py
.venv/Scripts/python.exe desktop/verify_installer.py releases/PhotoCollection-Setup-2.7.0-x64.exe
```

安装验证会拒绝覆盖已有的注册安装副本。分发包不得包含个人库配置、数据库、原片、模型权重或密钥。

## 仓库导航

| 目录 | 内容 |
| --- | --- |
| `backend/app/` | FastAPI、数据库、迁移、EXIF、搜索、人物、水印、水彩和任务服务 |
| `frontend/src/` | React 页面、路由、主题、翻译、浏览及编辑工作流 |
| `desktop/` | Windows 启动器、安装脚本、打包与实际应用验证 |
| `backend/tests/`、`frontend/tests/` | 隔离照片库及界面回归 |
| `plugins/` | 用户显式运行的本地插件示例 |
| `docs/` | 当前使用说明、开发交接与历史记录 |

贡献流程见 [CONTRIBUTING](CONTRIBUTING.md)，后续自动化开发约束见 [AGENTS](AGENTS.md)。旧 Express 原型已移除，可通过 Git 历史查看。

## 许可证 / License

项目代码采用 [MIT License](LICENSE)，Copyright (c) 2026 wonderhate。Windows 安装包和便携包均附带 `LICENSE`。

Project code is licensed under the [MIT License](LICENSE). Bundled third-party components, fonts and artwork retain their respective licenses and notices.

第三方组件、字体及品牌资源沿用各自授权：字体 OFL 文本随资源保留；品牌图案来源见 `backend/app/assets/brand_logos/sources.json`。

## 独立网站工程与发布

`web/` 保存正式展示页、下载页与完整浏览器本地图库工程，独立安装依赖和构建：`npm ci --prefix web/frontend`、`npm --prefix web test`、`npm --prefix web run build`。作品清单、作者凭证和部署产物留在本机，不进入仓库。现有 EdgeOne 项目通过本机作者发布器更新，维护记录见 [网站整合](web/docs/website-lumina-integration.md)。

Windows 2.7.0 为公开试用；Linux 继续提供 [2.6.1 预览包](https://github.com/wonderhate/photo-management/releases/tag/v2.6.1)，保留其构建脚本和 [平台限制](docs/linux-desktop.md)。新版本的安装覆盖、跨版本升级和卸载尚待验收，操作前备份图库。
