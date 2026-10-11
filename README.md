# 光影集 · 本地摄影照片管理

Windows 本地优先照片管理系统，当前开发版 **2.2.1**，Android 远程客户端 **2.0.0**。React / TypeScript / Vite，FastAPI / SQLAlchemy / SQLite，Pillow / HEIF / rawpy，本地 Chinese-CLIP 与可选 OpenCV 人物识别。

**原始照片只读。** 导入登记绝对路径与 SHA-256；删除图库记录、水印草稿或人物分组均不删除原始 JPG / RAW。照片与关键词不上传第三方。桌面服务监听局域网接口，远程访问默认关闭；开启后必须配对才能访问。手机只缓存 JSON 索引，图片预览不落盘。

本次远程版本在本机 `releases/`，用法及验证记录见 [手机远程客户端](docs/android-remote.md)。以下 GitHub 下载仍是历史发布 **2.1.1 / Android 1.0.0**，不包含此次远程功能。

| 历史公开下载 | 用途 |
| --- | --- |
| [Windows 安装程序（推荐）](https://github.com/wonderhate/photo-management/releases/download/v2.1.1/PhotoCollection-Setup-2.1.1-x64.exe) | Windows 10 / 11 x64，中文向导、快捷方式、卸载入口 |
| [Windows 便携 ZIP](https://github.com/wonderhate/photo-management/releases/download/v2.1.1/PhotoCollection-Windows.zip) | 解压即用，保留 `_internal` 文件夹 |
| [Android APK](https://github.com/wonderhate/photo-management/releases/download/v2.1.1/PhotoCollection-Android.apk) | Android 10+，手机独立照片库，实际版本 1.0.0 |
| [SHA-256 校验文件](https://github.com/wonderhate/photo-management/releases/download/v2.1.1/SHA256SUMS.txt) | 核对下载完整性；不是发布者签名 |

## 1. 安装与手动启动

### Windows 独立应用

[下载 Windows 2.1.1 与 Android 安装包](https://github.com/wonderhate/photo-management/releases/tag/v2.1.1)。Windows 包已经构建，不需要先从源码安装依赖；Android 附件的实际版本为 **1.0.0**，与桌面版本分别编号。

**下载安全提示**：Windows 当前没有受信任的代码签名，SmartScreen / 未知发布者提示仍可能出现；Android APK 已使用原发布密钥签名，侧载许可和 Play Protect 扫描提示仍可能出现。防病毒扫描与发布者信誉是不同的检查，不建议关闭防护。检查结果、文件校验方法及仍需的账号/证书见 [下载与安全检查](docs/apps-security.md)。iOS 应用开发已取消，相关代码与构建文件已移除；目前提供 Windows、Android 和网页版本。

下载并打开 `PhotoCollection-Setup-2.1.1-x64.exe`，按中文向导安装。默认安装在当前用户的 `%LOCALAPPDATA%\Programs\PhotoCollection`，不要求管理员权限；可选桌面快捷方式，开始菜单提供启动与卸载入口。缺少 WebView2 时，安装器运行经过 Microsoft 发布者签名验证的官方引导程序，需要联网；安装失败会明确提示并停止。关闭旧应用后再运行安装程序即可覆盖升级。卸载保留照片库、模型缓存、导出文件及用户创建的配置。

也可以解压 `PhotoCollection-Windows.zip` 到可写文件夹，双击 `PhotoCollection.exe`。必须保留同目录 `_internal`；两种 Windows 包都无需安装 Python 或 Node.js。窗口使用 Windows WebView2，Windows 11 通常已自带。

新版独立应用优先使用 8000 端口，被占用时使用其他空闲端口，手机地址以设置页为准。远程访问默认关闭，开启后须配对。关闭窗口会停止该实例的 HTTP 服务，正在执行的后台任务完成后进程退出。默认数据库和缓存放在 `%LOCALAPPDATA%\PhotoCollection\data`，模型放在同级 `models`，导出到用户 Downloads。可以在 EXE 同目录放 `library-config.json` 指定已有库；不能在不同应用实例中同时执行库迁移或移动数据库。

开发者打包：安装原有后端及 AI 依赖后执行 `./build-windows.ps1`。`-UseCurrentLibrary` 只为本机解压目录写入现有库配置，**分发 ZIP 不包含该配置、数据库、模型权重或照片**。无界面诊断可运行 `PhotoCollection.exe --serve --duration 60 --status-file status.json`，日志在 `%LOCALAPPDATA%\PhotoCollection\logs\desktop.log`。

制作安装程序：安装官方 [Inno Setup 7](https://jrsoftware.org/isdl.php) 后运行 `./build-installer.ps1 -Compiler 'C:\Program Files\Inno Setup 7\ISCC.exe'`。先运行 Windows 打包脚本，再运行安装器脚本；输出在 `releases/PhotoCollection-Setup-2.1.1-x64.exe`。WebView2 引导程序首次从 Microsoft 下载并验证 Authenticode，私人 `library-config.json` 始终排除。`desktop/verify_installer.py <安装程序路径>` 实际检查隔离安装、升级、窗口启动、卸载和数据保留；已安装正式软件的账户应改用专用测试账户，验证脚本会拒绝覆盖现有安装。

升级时先关闭旧版，将新 ZIP 解压到新目录；有本机 `library-config.json` 时复制该配置到新 EXE 同目录。不要用公开包中的示例覆盖已有配置、数据库或模型缓存。默认库仍使用 `%LOCALAPPDATA%\PhotoCollection\data`。

中文 PowerShell 打包脚本使用 UTF-8 带 BOM，兼容 Windows PowerShell 5.1。若旧版脚本出现中文乱码或解析错误，更新仓库；无需手工创建另一个 `build-windows.utf8.ps1`。

测试记录见 [应用验证说明](docs/apps-verification.md)。Windows 原生窗口启动、Android 模拟器实际编辑/恢复/导出与原图保护已检查；不同实体手机的相册权限和格式兼容性仍需安装后确认。

### Android 远程客户端

Android 2.0.0 访问电脑照片库，需要同时运行本次 Windows 2.2.0 或更新后的源码服务；历史 Windows 2.1.1 包不支持配对。支持 Android 10+ 和较新的 Android System WebView。

1. 电脑「设置 → 手机远程访问」开启访问，查看电脑地址和八位配对码。
2. 手机和电脑连接同一 Wi-Fi 或私有 VPN，安装 `releases/PhotoCollection-Android.apk`，填写地址和配对码。再次使用可选择「连接已配对的电脑」。
3. 手机底部提供照片、影集、创作、报告、我的。智能影集、人物、时间线与统计在「我的」中进入；筛选、评分、标签、多选、对比、删除记录等复用电脑端功能。
4. 整理、AI、水印渲染和草稿都保存在电脑。手机仅保存索引、连接信息和界面偏好，不缓存原图、缩略图、水印预览或离线编辑队列。
5. 单张导出后，电脑生成成品并自动保存到手机相册 `Pictures/PhotoCollection`。批量任务完成后逐个点击作品链接保存到手机。下载失败会报错，可从电脑水印图库再次导出。
6. 手机隐藏原图下载。打开原图、文件位置和文件选择器对应电脑；导入也可填写电脑绝对路径。

电脑需要保持运行。配对码有效 10 分钟，设备会话有效 30 天；电脑生成新码会撤销旧设备，也可立即关闭访问。当前连接方式为局域网 / 私有 VPN 的 IP 地址，未部署公网穿透或云中转。

覆盖升级继续使用原签名，保留旧独立库及已有相册导出；新客户端不再打开旧库，只清理旧派生预览。清除应用数据不会影响电脑库或已导出的相册作品。

开发者运行 `./build-android.ps1` 完成构建、Lint、单元测试和签名验证；保留私有 `.runtime/signing/` 密钥用于覆盖升级。完整用法与实际验证边界见 [远程客户端说明](docs/android-remote.md)。

### 网页容器包（GitHub Packages）

[容器包页面](https://github.com/users/wonderhate/packages/container/package/photo-management)：`ghcr.io/wonderhate/photo-management:2.1.1`，同时提供 `latest`。GitHub Actions 构建实际镜像、检查导入/草稿/导出和原图哈希后才发布，镜像使用非 root 用户；不包含任何私人库或照片。首次发布的包默认为私有，仓库所有者需在 Package settings → Change visibility 设为 Public 后，其他用户才能匿名拉取；仓库公开不等于容器包自动公开。

已安装 Docker 的电脑可运行以下 PowerShell 命令。将 `D:\Photos` 换成自己的照片目录，该目录**只读挂载**；数据库和派生导出保存在独立 Docker volume 中，卸载容器不删除 volume。打开 <http://127.0.0.1:8000>，导入框填写容器里的 `/photos` 路径。

```powershell
docker run -d --name photo-management -p 127.0.0.1:8000:8000 --mount type=volume,source=photo-management-data,target=/data --mount "type=bind,source=D:\Photos,target=/photos,readonly" ghcr.io/wonderhate/photo-management:2.1.1
```

这是图库、EXIF、影集、统计、报告与水印的基础网页版。镜像不安装桌面 Chinese-CLIP / 人物识别依赖，也不提供 Windows 原生文件选择器；智能功能使用 Windows 应用或源码版。不要把端口公开到互联网，历史 2.1.1 容器没有配对认证；本次源码支持受控配对，但未重新发布容器。使用新版前备份数据卷中的 `library.db` 和派生文件，不要运行删除数据卷的命令。开发者也可用 `docker build -t photo-management .` 构建；工作流位于 `.github/workflows/package.yml`。

### 源码启动

需要 Python 3.12+、Node.js 22.12+，并使 `python`、`npm` 可在 PowerShell 找到。本次验证使用 Python 3.12.10 / Node.js 24.19。

```powershell
cd C:\Users\wonder\Documents\ChatGPT\photo_collection

# 新电脑：安装基础依赖、构建并启动
.\start.ps1 -Install

# 已安装：启动（也可以双击 start.cmd）
.\start.ps1

# 更新代码后：重新构建并重启受管理的服务
.\start.ps1 -Rebuild -Restart

# 停止服务
.\stop.ps1
```

打开 <http://127.0.0.1:8000>。后台服务启动后可以关闭启动窗口。`-NoBrowser` 可禁止自动打开浏览器。

如果 PowerShell 阻止脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Install
```

只对这次启动使用该参数，不需要修改全局执行策略。脚本会核对库位置、版本与构建标识，避免误用旧后台服务。

可选智能功能：

```powershell
# Chinese-CLIP / FAISS 依赖
.\start.ps1 -AI -Restart

# 人物识别依赖（Windows wheel，无需 dlib/CMake）
.\start.ps1 -Faces -Restart
```

安装后进入设置加载 Chinese-CLIP；进入人物页下载 YuNet / SFace 模型。模型下载到 `models/`，下载的是公开权重，照片不上传。

## 2. 照片库、原图与导出目录

首次使用可以直接启动：未提供本机配置时，数据库与缓存默认位于项目 `data/`，导出位于 `data/exports/`。

也可以把 `library-config.example.json` 复制为 `library-config.json`，修改目录后重启。配置文件不提交 Git。

源码新增「设置 → 照片库与存储」目录编辑入口：可以选择文件夹或填写绝对路径，自定义照片库（数据库与缓存）、AI 模型缓存、水印导出和多个自动扫描照片目录。「保存目录设置」后显示待生效的新位置，刷新页面仍保留；也可以「取消待生效修改」。修改在下次启动程序时生效，网页刷新不会切换正在使用的照片库。

修改照片库位置时必须选择空目录；关闭其他应用实例后重启，程序会复制数据库、影集、草稿、预览、人物缓存及浏览器导入文件，验证数据库后再切换。外部原图保持原位置，旧照片库保留；目标已有文件、复制失败或配置写入失败时继续使用原库并显示错误。首次复制较大的库可能需要等待。导出路径只改变后续导出位置，历史导出保留原位置并继续可下载。模型目录改动不搬动原缓存；新目录为空时需重新准备模型。

Windows 打包源码将界面配置写入 `%LOCALAPPDATA%\PhotoCollection\library-config.json`，兼容读取旧 EXE 同目录的配置；个人配置保存后优先使用，不会写入安装目录。源码版仍写入项目 `library-config.json`。显式设置 `PHOTO_DATA_DIR` 的实例使用该数据目录内的独立配置，不读取本机项目配置；由 `PHOTO_DATA_DIR`、`PHOTO_MODELS_DIR`、`PHOTO_EXPORT_DIR` 指定的路径在界面中锁定。容器中的路径指容器可见的目录，需要预先配置挂载。详细实现和验证见 [目录设置验证](docs/storage-paths.md)。本机 Windows 2.2.1 安装包已同步目录设置和新版界面。

```json
{
  "data_dir": "D:\\PhotoLibrary",
  "models_dir": "D:\\PhotoModels",
  "exports_dir": "D:\\PhotoExports",
  "scan_paths": ["D:\\Photos"]
}
```

此电脑使用：

| 用途 | 目录 |
| --- | --- |
| SQLite / 派生缓存 | `G:\修后图` |
| 自动扫描原图 | `G:\摄影\修后图` |
| 正式水印导出 | `C:\Users\wonder\Downloads` |
| 模型缓存 | 项目 `models/` |

启动或打开网页会后台递归扫描；可以手动点击「同步目录」。排除扫描根目录中的 thumbnails、previews、watermark_previews、embeddings、exports、export-records、imports、backups，以及已登记的自定义导出文件。原图不复制；浏览器拖入文件无法取得绝对路径，会先明确提示，再将显式拖入的文件复制到 `imports/`。

实际库目录结构：

```text
library.db
settings.json
thumbnails/          照片缩略图
previews/            浏览预览
watermark_previews/  水印草稿预览
faces/               人脸局部缩略图
embeddings/          .npy 视觉向量
export-records/      本程序生成文件的下载登记
exports/             默认导出或手动数据库备份
backups/             自动升级／合并前的一致性备份
imports/             显式拖入的副本
```

Downloads 中其他私人文件不会被开放为下载链接。同名导出自动编号；绝不覆盖原图。

## 3. 照片导入、浏览和整理

- 导入单张、多张、目录与子目录；后台显示成功、跳过、失败、当前文件与取消状态。
- JPG / JPEG / PNG / TIFF / HEIC / HEIF，以及 ARW / CR2 / CR3 / NEF / RAF / DNG / ORF / RW2 / PEF。RAW 预览是否可用取决于 rawpy/LibRaw 对具体文件的支持；无法解码时仍保存元数据与明确错误。
- SHA-256 内容去重。原文件移动后，再导入同一内容可重新定位旧记录。
- RAW＋JPG 按同目录、文件名主体及元数据一致性配对，默认一张图库卡片、一次拍摄；存在歧义时不按时间盲目配对。
- 虚拟滚动、网格大小／间距／圆角、拍摄时间／导入时间／文件名排序，悬停预览、详情 EXIF、收藏、五星评分、颜色标签、标签、批量整理和 2–4 张对比。
- 筛选相机、镜头、焦距、光圈、ISO、快门、日期、方向、文件类型、收藏、标签、评分、颜色和影集。普通影集支持封面与手动排序。
- 缩略图与 EXIF 使用导入缓存；浏览缓存最多 600 条，旧筛选请求不会混入新结果。

浏览器刷新会恢复页面路由；快捷键可在设置中修改，`?` 打开帮助。提供明暗主题、首次引导和最近操作记录。英文目前覆盖部分主界面，编辑器与部分报告文字仍为中文。

## 4. 统计、时间线与摄影报告

独立统计页提供焦段、光圈、ISO 和快门的分组／精确值分布；点击图表联动图库。时间线按年／月／日浏览，分页加载并提供每日热力数据。

月报、年报、镜头报告包含拍摄数、文件数、使用天数、器材排行、月份趋势、焦段偏好、光圈／ISO／快门、镜头生命周期与变焦区间。默认按 `capture_group` 去重；设置可切换按文件计数，时间线遵循同一口径。全部基于数据库，不重新解析磁盘 EXIF。

## 5. 智能搜索与智能影集

在设置加载 `OFA-Sys/chinese-clip-vit-base-patch16`。首次下载公开模型，后续使用本地缓存。自动选 CUDA，CPU 也可用；AI 加载失败不阻塞导入、统计和水印。

智能影集填写名称、关键词、AND／OR、相似度阈值与上限，预览候选后手动增删并保存。影集保留关键词和模型信息，可重新运行。

照片搜索框的自然语言入口使用规则解析日期、焦距、光圈等，例如「2026年9月 50mm 日落」。剩余「日落」交给视觉模型，与 EXIF 条件取交集；模型未就绪会明确提示，不丢弃画面条件或冒充文件名搜索。普通输入仍可按文件名搜索。

图片向量只生成一次并保存为 `.npy`。可选 FAISS 使用标准化向量，AND／OR 与线性余弦定义一致；照片 ID、模型和向量文件变化会刷新索引，损坏向量可重建。

## 6. 人物工作流

人物页下载两份 OpenCV ONNX 权重并验证 SHA-256：[官方模型与使用说明](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html)。分析使用预览，支持后台进度与取消，跳过已分析照片。

流程：本地检测 → SFace 相似度分组建议 → 命名／确认分组 → 检查局部人脸图并重新关联 → 查看人物照片。相似度可调，建议默认 0.45；自动分组需要人工确认，不能保证身份识别准确率。删除人物保留照片，把相关人脸放回待确认列表。

人物卡片新增「新建人物影集」：分组全部确认且有照片后可用，默认以人物名称命名，可改名或取消；保存后直接打开新影集，并可在「影集」页找到。一次收入该人物当前分组的全部照片，不受人物页分页限制，RAW + JPG 和同次拍摄的重复人脸只计一次。创建的是普通影集；后续人物改名、重新分类或删除人物不会自动改动该影集，删除影集也保留原图。这项更新适用于 Windows 源码版和使用该后端的网页版，现有 v2.1.1 发布安装包未重新打包。

未安装依赖或模型时显示安装／下载入口；解码失败与“没有人脸”分开报告。人脸向量只保存在本机 SQLite。

## 7. 水印工坊与水印图库

图库选择照片后进入「水印工坊」。提供摄影相框（现代信息栏／经典相框）和沉浸光感；相框、主题、字号、EXIF 字段、署名、圆角以及模糊、亮度、饱和度、主图比例、阴影可调，实时预览。缺失 EXIF 自动隐藏。

相框实现依据参考图分析，见 `docs/watermark-reference-analysis.md`。品牌图案来源记录于 `backend/app/assets/brand_logos/sources.json`。

「保存到水印图库」只保存编辑配置与低分辨率 WebP 预览，不生成最终导出。首次显式保存后启用约 1.2 秒自动保存；支持当前会话撤销／重做、未保存退出提醒和重启恢复。

水印图库支持搜索、排序、模板和状态筛选、多选、复制、继续编辑、编辑中／待导出／已导出分类。「导出后有修改」由编辑 revision 与导出 revision 判断。删除草稿只删记录和派生预览；原图丢失保留草稿，可重新定位。

JPG / PNG 导出，质量 1–100，原始尺寸／4096／2560／2048／自定义长边，文件名模板。批量导出使用**每份草稿各自的设计参数**，只统一用户选择的输出格式、质量和尺寸。

## 8. 后台任务和插件

导入、导出、人物分析任务在后台运行，可取消。最近 100 条任务保存到 SQLite；重启后未完成任务标记“中断”，保留已完成成果，需要手动重新执行。重复导入按哈希跳过；导出重试可能产生新编号文件。系统通知需用户授权。

插件放在项目 `plugins/`，定义 `run(ctx)`。查看列表只解析代码，不执行脚本；点击运行后才执行。`ctx.photos(limit=500, offset=0, **filters)` 分页读取，单页最多 2000；`ctx.update(...)` 修改收藏、评分、颜色和标签；`ctx.message(...)` 输出日志。数据库更新整批提交或回滚。脚本具有本机 Python 权限，只使用可信代码；长时间脚本建议分批执行。

## 9. 备份、升级与迁移

设置页「备份数据库」使用 SQLite backup API，备份保存于库 `exports/`。启动自动补齐旧库字段，升级前备份至 `backups/`；已有表与新增索引也会校验。

备份整个库时一并保存 `settings.json`、本机配置、派生缓存和 `models/`；**原图需要另行备份**，数据库不会包含原图。恢复前停止服务，把备份恢复到库的 `library.db`；原图目录变化时需要修复路径。

两库合并工具先预演，不修改输入库，不移动／写入原图：

```powershell
.\stop.ps1
.\.venv\Scripts\python.exe backend/library_maintenance.py --target "D:\PhotoLibrary\library.db" --source "E:\OldLibrary\library.db" --stage ".runtime\merge-preview.db" --old-root "D:\OldPhotos" --new-root "E:\Photos"
```

检查输出后，用新的暂存文件名再执行，并加 `--apply`。应用前自动备份两份库。只支持当前系统同类库，拍摄组冲突会停止；目标库先用当前程序启动升级。当前电脑已合并两库，保留 1438 文件／1429 拍摄／2 草稿；13 条缺失文件记录保留待重新定位，不擅自删除。

## 10. 开发、测试和验证边界

```powershell
# 后端开发
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
# 另一终端：前端开发
npm ci --prefix frontend
npm run dev --prefix frontend

# 自动回归和构建
npm test
npm run test:frontend
npm run build
# 隔离数据库的 50000 文件性能探针
.\.venv\Scripts\python.exe -m backend.benchmark
```

实际 HTTP 验收（只能操作 `.test-artifacts` 下的测试库）：

```powershell
$env:PHOTO_DATA_DIR = Join-Path $PWD '.test-artifacts\release\library'
$env:PHOTO_AUTOLOAD_AI = '0'
.\.venv\Scripts\python.exe -m backend.e2e_fixture
# 在独立终端保持服务运行；同样设置上述两个环境变量
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8088
# 另一终端执行
npm run test:http
```

真实库启动前，在对应终端移除 `PHOTO_DATA_DIR` / `PHOTO_AUTOLOAD_AI` 环境变量，或打开新 PowerShell。完整结果与限制见 **[docs/verification.md](docs/verification.md)**。

2026-10-10 已验证：37 项后端测试、3 项前端逻辑测试、前端生产构建、16 项真实 HTTP 工作流、真实 CPU Chinese-CLIP / FAISS、真实 YuNet / SFace，以及 50000 文件的数据库性能。1425 个可用原图的 SHA-256 均与库中原有哈希一致，13 个缺失原图待定位。

最终启动自动同步新增 110 个原图记录：当前 1548 文件／1539 拍摄／2 草稿，1539 个语义向量就绪。再次核对 1535 个可用原图的哈希全部一致，13 条缺失记录保留。GitHub Checks 在 main 更新时执行基础测试与前端构建，真实模型和网页交互验收按下面的边界单独检查。

[GitHub 云端验证](https://github.com/wonderhate/photo-management/actions/runs/38041517234)已通过基础回归和生产构建；六节分支与 main 均已发布，具体结果见 `docs/verification.md`。

**网页验收范围**：另一台 Windows 电脑提供了 2.1.0 的安装与测试报告，报告称真实 Playwright 检查了 11 个页面及 390×844 布局，并发现浅色主题的影集标题和人物卡片问题；其原始截图与日志尚未传入本工作区。这些报告结果与本机实测分开记录。本机 Codex Browser 此前因访问权限无法验证而拒绝访问，没有绕过该限制。

2.1.1 修复上述卡片及浅色主题逗号选择器，并新增 GitHub Actions 中的独立 Chromium 回归：只加载生产前端和合成 API 数据，检查明暗主题、1440 / 390px、文字对比度、人物操作按钮是否在卡片内以及弹出面板样式，不访问真实照片库。它不替代原生文件选择器、拖拽和全部水印交互的人工验收。重复运行：

```powershell
npm run build --prefix frontend
cd frontend
npx playwright install chromium
npx playwright test
```

最终实测通过：39 项后端、3 项前端逻辑、5 项 Chromium 回归（含 11 个主要页面及真实水印保存/恢复/导出流程）；新 EXE 的 16 项 HTTP 流程、721 个合成源文件哈希保护、WebView2 窗口与升级后的离线 Chinese-CLIP。Android 正式 APK 覆盖安装和完整设备测试通过。详见 [2.1.1 应用验证](docs/apps-verification.md#最终安全修订与发布包)与 [安全检查](docs/apps-security.md)。

如果模型下载遇到代理 502 或证书错误，先检查代理和 Windows 信任的证书链，保留 TLS 校验。已有模型时可在设置中指定本地模型目录并离线加载。另一台电脑使用了 `HF_ENDPOINT` 镜像与 `pip-system-certs`；这是该机器的网络配置，不是应用必需依赖，也不会写入分发包。使用镜像前自行确认来源，环境变量只在启动应用前设置才生效。

## 11. 项目结构与 Git 工作流

```text
backend/app/       API、模型、迁移、独立 EXIF/AI/水印/人物服务
backend/tests/     隔离库测试
frontend/src/      页面、组件、路由与缓存逻辑
frontend/tests/    逻辑测试与网页验收脚本
plugins/           本地插件示例
docs/              参考图分析、分节计划与验证记录
legacy/            旧 Express 原型代码与独立测试（非当前运行入口）
```

六节优化分别使用 `codex/library-migration`、`codex/library-correctness`、`codex/search-correctness`、`codex/runtime-stability`、`codex/people-workflow`、`codex/release-verification`，验证后以合并提交进入 `main`。计划见 `docs/stabilization-plan.md`。

旧原型用户数据仍在原位，未移动照片。私人照片、界面截图、数据库、缓存、模型、本机配置与运行日志不上传 GitHub。
