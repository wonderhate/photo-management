# 光影集 · 本地摄影照片管理

Windows 本地优先照片管理系统，当前版本 **2.1.1**。React / TypeScript / Vite，FastAPI / SQLAlchemy / SQLite，Pillow / HEIF / rawpy，本地 Chinese-CLIP 与可选 OpenCV 人物识别。

**原始照片只读。** 导入登记绝对路径与 SHA-256；删除图库记录、水印草稿或人物分组均不删除原始 JPG / RAW。照片与关键词不上传第三方。默认仅监听 `127.0.0.1:8000`。

## 1. 安装与手动启动

### Windows 独立应用

[下载 Windows 2.1.1 与 Android 安装包](https://github.com/wonderhate/photo-management/releases/tag/v2.1.1)。Windows 包已经构建，不需要先从源码安装依赖；Android 附件的实际版本为 **1.0.0**，与桌面版本分别编号。

**下载安全提示**：Windows 当前没有受信任的代码签名，SmartScreen / 未知发布者提示仍可能出现；Android APK 已使用原发布密钥签名，侧载许可和 Play Protect 扫描提示仍可能出现。防病毒扫描与发布者信誉是不同的检查，不建议关闭防护。检查结果、文件校验方法及仍需的账号/证书见 [下载与安全检查](docs/apps-security.md)。iOS 保持暂停。

解压 `PhotoCollection-Windows.zip` 到可写文件夹，双击 `PhotoCollection.exe`。必须保留同目录 `_internal`；无需安装 Python 或 Node.js。窗口使用 Windows WebView2，Windows 11 通常已自带；缺少时从 Microsoft 安装 WebView2 Evergreen Runtime。

独立应用使用自己启动的随机本地端口，只监听 `127.0.0.1`，关闭窗口会停止该实例的 HTTP 服务，正在执行的后台任务完成后进程退出。默认数据库和缓存放在 `%LOCALAPPDATA%\PhotoCollection\data`，模型放在同级 `models`，导出到用户 Downloads。可以在 EXE 同目录放 `library-config.json` 指定已有库；不能在不同应用实例中同时执行库迁移或移动数据库。

开发者打包：安装原有后端及 AI 依赖后执行 `./build-windows.ps1`。`-UseCurrentLibrary` 只为本机解压目录写入现有库配置，**分发 ZIP 不包含该配置、数据库、模型权重或照片**。无界面诊断可运行 `PhotoCollection.exe --serve --duration 60 --status-file status.json`，日志在 `%LOCALAPPDATA%\PhotoCollection\logs\desktop.log`。

升级时先关闭旧版，将新 ZIP 解压到新目录；有本机 `library-config.json` 时复制该配置到新 EXE 同目录。不要用公开包中的示例覆盖已有配置、数据库或模型缓存。默认库仍使用 `%LOCALAPPDATA%\PhotoCollection\data`。

中文 PowerShell 打包脚本使用 UTF-8 带 BOM，兼容 Windows PowerShell 5.1。若旧版脚本出现中文乱码或解析错误，更新仓库；无需手工创建另一个 `build-windows.utf8.ps1`。

测试记录见 [应用验证说明](docs/apps-verification.md)。Windows 原生窗口启动、Android 模拟器实际编辑/恢复/导出与原图保护已检查；不同实体手机的相册权限和格式兼容性仍需安装后确认。

### Android 独立应用

将 `releases/PhotoCollection-Android.apk` 传到手机，在文件管理器中打开并允许该文件管理器安装应用。支持 Android 10+；需要正常可用、较新的 Android System WebView。手机库完全独立，**不用电脑、不用局域网、不用账户**。

1. 打开“光影集”，点击“选择照片”从系统相册/文件选择器选图，或点击“授权并扫描相册”。Android 14+ 可以只授权部分照片；扫描范围服从系统授权。
2. 应用保存内容 URI、SHA-256、EXIF、收藏与标签，**不复制整个手机相册，不写入原图**。图库每页 40 张，预览缓存可清理。
3. 在“智能”中分析尚未识别的照片，模型随 APK 安装并离线运行。输入 `日落`、`海边 AND 日落`、`猫 OR 狗`，调整置信阈值，选择候选后保存影集；普通影集从照片页多选后创建。
4. 照片详情 → 创建水印 → 选择相框 / 沉浸光感、EXIF、署名 → 保存到水印图库。已有草稿约 1.5 秒自动保存；首次预览不会自动创建草稿。支持继续编辑、复制、撤销/重做、待导出状态与单张 / 批量导出；每个作品使用自己的参数。
5. 导出创建新图片，写入手机 `Pictures/PhotoCollection`，可在系统相册找到。JPG / PNG、长边 1080 / 2048 / 2560 / 4096、JPG 质量可选。可用内存不足时自动收紧导出尺寸并提示，手机不提供无限尺寸导出；导出时保持应用打开。
6. 设置显示可用空间、数据库和预览缓存占用；缓存上限 16–2048 MB，默认 128 MB。实际预算自动限制在可用空间扣除 100 MB 后的四分之一以内，空间不足 100 MB 时停止导出。缓存只保存派生缩略图，清理后按需重新生成，草稿仍然保留。

手机数据库、草稿和视觉标签在应用私有存储中，手机系统管理其位置；**卸载或清除应用数据会移除这些记录**，手机原图和已经导出的相册文件保留。相册访问被撤销、照片被移走或删除时，作品仍保留并提示重新授权。重新授权同一照片可恢复引用；当前手机版不提供把缺失作品绑定到不同文件的定位工具。

手机版的离线智能分类使用 [ML Kit 内置视觉标签模型](https://developers.google.com/ml-kit/vision/image-labeling/android)，是画面标签及中文关键词映射，**不是桌面 Chinese-CLIP 的中文语义 embedding**。抽象情绪、复杂语句和人脸分组仍使用桌面版。手机 HEIC 解码依赖系统，部分 RAW 能读取 EXIF 但不能预览；手机版摄影报告按文件计数，目前不提供桌面 RAW+JPG 拍摄组统计及镜头生命周期报告。Android 清单已移除网络权限，手机照片不会通过此应用上传。

开发者使用 JDK 17、Android SDK 35 / Build Tools 35.0.0，项目 Gradle Wrapper 会下载并验证 Gradle 8.11.1，也可以指定已安装的 Gradle，执行：

```powershell
.\build-android.ps1 -JavaHome 'D:\jdk-17' -AndroidSdk 'D:\Android\Sdk' -Gradle 'D:\gradle-8.11.1\bin\gradle.bat'
```

脚本构建、运行 Android 测试与 Lint，并验证发布签名。首次自动生成本机签名密钥，保存在 `.runtime/signing/`，不会提交到 Git；请备份该目录，未来更新 APK 必须使用同一密钥。重新生成密钥会导致手机无法覆盖安装旧版本；不要通过卸载解决，以免丢失草稿。第三方组件遵循各自开源许可证，模型版权归其提供方；不附带用户照片。

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

也可以把 `library-config.example.json` 复制为 `library-config.json`，修改三个目录后重启。配置文件不提交 Git。

```json
{
  "data_dir": "D:\\PhotoLibrary",
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
