# 光影集 · PhotoCollection

<img src="frontend/public/icon-192.png" width="72" alt="光影集图标">

本地优先的摄影照片管理软件。当前版本 **2.6.1**，提供 Windows 桌面应用和本机网页版；默认进入摄影空间。

站点：<https://photomanagement.online/> · [Windows 下载页](https://photomanagement.online/windows.html)（页面显示 v1.0，与本仓库 v2.6.1 是同一份发布副本）


[![Checks](https://github.com/wonderhate/photo-management/actions/workflows/checks.yml/badge.svg)](https://github.com/wonderhate/photo-management/actions/workflows/checks.yml)
[最新下载](https://github.com/wonderhate/photo-management/releases/latest) · [开发交接](docs/development-handoff-2026-10-13.md) · [文档索引](docs/README.md) · [版本记录](CHANGELOG.md)

## 下载与安装

| 文件 | 用途 |
| --- | --- |
| [Windows 安装包](https://github.com/wonderhate/photo-management/releases/download/v2.6.1/PhotoCollection-Setup-2.6.1-x64.exe) | Windows 10 / 11 x64，安装向导、快捷方式和卸载入口 |
| [Windows 便携包](https://github.com/wonderhate/photo-management/releases/download/v2.6.1/PhotoCollection-Windows.zip) | 解压后运行 `PhotoCollection.exe`，保留同目录 `_internal` |
| [SHA-256 校验](https://github.com/wonderhate/photo-management/releases/download/v2.6.1/SHA256SUMS.txt) | 核对下载完整性 |

Windows 包无需 Python 或 Node.js。安装器使用当前用户目录；关闭旧程序后可覆盖升级，卸载保留用户配置、照片库和导出。缺少 WebView2 时会运行经过 Microsoft 签名验证的引导程序。应用本身尚无受信任的代码签名，SHA-256 校验不等同于发布者签名。

当前不提供 Android / iOS 客户端、手机配对、远程访问或公网转发。历史版本说明仅用于追溯，请使用最新版本。

## 能做什么

- **照片库**：目录与文件导入、内容去重、RAW + JPG 拍摄分组、EXIF、筛选、收藏、评分、颜色圆环、标签与批量整理。
- **摄影空间**：等高照片布局、时间线、器材统计、月报 / 年报 / 镜头报告、照片对比和普通影集。
- **本地智能整理**：Chinese-CLIP 语义搜索和智能影集；OpenCV 人物检测、分组建议、人工确认、创建与打开人物影集。
- **水印工坊**：摄影相框、沉浸光感、EXIF 信息、中文及英文艺术字署名；草稿保存、恢复、复制、状态筛选、逐作品参数批量导出。
- **水彩转绘**：千问 `qwen-image-3.0` / `qwen-image-3.0-pro` 可选；支持单图及最多 100 张批量转绘，可选在图片生成后逐张生成 AI 标题；本地纸纹、55% / 85% 留白排版、原图对比、PNG / JPG 导出和水印联动。
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
docker build -t photo-management:2.6.1 .
docker run -d --name photo-management -p 127.0.0.1:8000:8000 --mount type=volume,source=photo-management-data,target=/data --mount "type=bind,source=D:\Photos,target=/photos,readonly" photo-management:2.6.1
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

本次验证：78 项后端、5 项前端逻辑、36 项浏览器检查，以及实际 Windows EXE / 安装升级 / 卸载验证通过，详见 [2.6.1 交付验证](https://github.com/wonderhate/photo-management/blob/v2.6.1/docs/windows-2.6.1-verification.md)。测试使用合成照片库；付费生图、其它电脑的网络与硬件需要单独验收。

发布构建：

```powershell
# 先准备后端、可选智能依赖和 desktop/requirements.txt
.\build-windows.ps1 -SkipDependencies
.\build-installer.ps1
.venv/Scripts/python.exe desktop/verify_package.py
.venv/Scripts/python.exe desktop/verify_installer.py releases/PhotoCollection-Setup-2.6.1-x64.exe
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
