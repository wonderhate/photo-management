# Windows、Android 与网页容器应用验证（2026-10-11）

Windows 独立程序：PyInstaller 6.22.3 / Python 3.12.10 / pywebview 6.2.1。Android 独立程序：AGP 8.9.2 / Gradle 8.11.1 / JDK 17 / compile & target SDK 35 / min SDK 29；模型随包安装。

## Windows

在生成的 `PhotoCollection.exe` 上运行 `desktop/verify_package.py`，测试库和输出全部隔离在 `.test-artifacts`，没有使用用户原图：

- 独立 EXE 启动、随机 localhost 端口、前端 HTML 与健康检查。
- 实际 JPG EXIF、重复导入、统计、创建水印草稿、正式导出、删除草稿和记录。
- `--ai` 读取已有模型缓存，实际加载 Chinese-CLIP CPU、生成 embedding、关键词检索。
- 测试原图前后 SHA-256 一致。
- 2.1.0 的 37 项后端测试通过；2.1.1 新增脚本编码回归后为 38 项，前端生产构建通过。
- `--window-check` 在隔离库上实际创建冻结 EXE 的 WebView2 原生窗口，收到页面加载事件后自动关闭，状态文件确认 `window_loaded=true`。

Windows 原生窗口内部的完整交互及文件选择器还需要人工验收。Codex 内置浏览器目前无法连接真实浏览器会话；窗口启动、程序及 API 检查不等于完整桌面交互验收，未绕过此前浏览器权限限制。

### Windows 2.1.1 与跨电脑反馈

另一台 Windows 电脑报告 2.1.0 源码安装、自行打包、16 项 HTTP 流程、离线语义索引、人物识别、11 个网页和 390×844 布局通过，同时报告两处浅色主题缺陷与 PowerShell 5.1 脚本编码问题。这是用户提供的外部测试报告；该机器的原始截图、日志和安装环境没有复制到本工作区，不能当成本机重复验证结果。

本次在 `codex/windows-light-theme-fixes` 中实际复现并修复：

- 影集浅色卡片标题与说明缺少颜色覆盖。
- 人物卡片 CSS 依赖未渲染的 avatar/info/actions 结构，缺少留白、文字颜色与按钮换行；修复直接使用已有 JSX，删除无效卡片样式。
- 浅色主题逗号后的 `Lselect`、`L.recent-panel` 等错误选择器，及窄屏子导航的字号覆盖顺序。
- 两个中文打包脚本的 UTF-8 BOM；`build-windows.ps1` 显式以 UTF-8 读取本机配置，避免中文照片库路径乱码。四个根目录 PowerShell 脚本均通过真实 Windows PowerShell 5.1 解析。

[GitHub Actions 主题回归](https://github.com/wonderhate/photo-management/actions/runs/38061688553)已通过：真实 Chromium 加载生产前端，四组 light/dark × 1440/390px，测量标题与说明的对比度至少 4.5:1，验证卡片按钮边界、长人物名、页面无横向溢出、下拉框/弹出面板以及窄屏导航。8 张截图均来自合成 API 数据，已检查代表性的明暗主题及窄屏截图。测试与用户登录的浏览器无关，不访问照片库、模型或原始文件；这次检查只覆盖修复涉及的界面。

对应 CI 同时通过 38 项后端测试、3 项前端逻辑测试、生产构建、Android 单元测试/Lint/构建。本机新 EXE（2.1.1，build id `f87671720352690e`）通过 720 次拍摄 / 721 个合成文件的 16 项真实 HTTP 工作流，正式生成各自使用不同模板的 PNG；全部 721 个测试源文件 SHA-256 一致，并确认 EXE 实际提供本次生产构建的 CSS。WebView2 原生窗口加载后自动关闭。另以 `HF_HUB_OFFLINE=1` 运行 `desktop/verify_package.py --ai`，实际加载本地 Chinese-CLIP、生成 embedding 和搜索通过。此处不重复访问用户原图；公开包排除私人配置、数据库、模型缓存和照片。

### 最终安全修订与发布包

上述 `f87671720352690e` 是界面修复阶段的构建。最终 2.1.1 发布包 build id 为 **`8c5460d4929c8d57`**，增加 PE 产品/版本信息、网页安全响应头，并更新 Transformers / Hub / cryptography。重新运行实际 EXE 的 16 项 HTTP 流程、721 个源文件哈希、WebView2 原生窗口以及离线 Chinese-CLIP 图像特征和中文搜索，均通过；搜索没有改写 embedding。ZIP 的 CRC、重复条目检查、build id、文档和私人文件排除检查通过。

[最终功能回归 CI](https://github.com/wonderhate/photo-management/actions/runs/38065079488)通过 39 项后端、3 项前端逻辑、5 项 Chromium 测试以及 Windows 脚本 / Android 检查。新增 Chromium 测试使用真实 FastAPI 和专用合成 JPG，遍历 11 个主要页面，完成水印预览、保存、刷新恢复、待导出和正式导出，检查没有页面异常、console error、5xx，源文件哈希一致。API、模型和原始文件均限于测试环境；并非用户已登录的内置浏览器或全套桌面交互验收。

Python 依赖复扫 69 个包无已知漏洞，前端 npm audit 为 0；Windows Defender 对发布目录扫描无该目录威胁。当前 Windows 仍未签名，Android 系统信誉判定未实测，剩余资源与验证边界见 [下载与安全检查](apps-security.md)。

### Windows 安装程序

使用 Inno Setup 7.1.0 制作 `PhotoCollection-Setup-2.1.1-x64.exe`，内含上述 build id `8c5460d4929c8d57` 的实际 EXE。Microsoft WebView2 引导程序打包前通过微软发布者 Authenticode 验证。

`desktop/verify_installer.py` 在专用临时安装目录实际通过：当前用户安装、两个开始菜单快捷方式、私人配置排除、同版本覆盖升级、用户配置/数据保留、安装后的 EXE 导入/EXIF/去重/统计/草稿/导出/原图保护，以及 WebView2 原生窗口 `window_loaded=true`。随后运行真实卸载器，确认程序、开始菜单与卸载注册移除，用户创建的配置及外部数据仍存在。测试拒绝覆盖账户内已有的正式安装；清理只作用于 `.test-artifacts` 下自己的目录，并处理 WebView2 长路径缓存。

本机已有 WebView2，未卸载系统运行库模拟缺失环境；自动安装运行库的分支经过编译与签名校验检查，但尚无干净虚拟机上的联网安装结果。安装程序仍未签名，未知发布者/SmartScreen 的限制不变。

## 网页容器 / GitHub Packages

[容器构建验证](https://github.com/wonderhate/photo-management/actions/runs/38099165258)通过。GitHub Linux runner 构建并运行实际 amd64 镜像，以非 root 用户启动，合成原图目录只读挂载；真实 HTTP 检查导入、草稿、环境光 PNG 导出、原图 SHA-256 不变、HTML CSP。镜像中没有私人配置、数据库或签名密钥。

工作流在 main 上验证后发布 `ghcr.io/wonderhate/photo-management:2.1.1` 和 `latest`，OCI source 标签关联当前仓库。基础镜像不包含桌面 AI / 人物识别依赖，也未验证 arm64。初次发布的可见性需单独设置为 Public；README 说明这一步，不能用 CI 推送成功代替匿名下载成功。数据库与派生文件使用独立数据卷，原图目录通过 Docker 的只读挂载保护。

## Android

3 项 Robolectric 测试通过，覆盖实际 Bitmap 渲染、环境光颜色、EXIF 隐藏、标签 AND/OR、无效参数、草稿重新打开、多版本互不影响、导出后修改状态、数值筛选、报告、缓存清理及安全删除。

Android 15 / API 35 / x86_64 AOSP 模拟器（WHPX）实际安装并运行 `IndependentAppTest`，通过：

1. 在模拟器相册创建专用合成 JPG，写入 85mm、f/1.4、1/500、ISO 100 EXIF 后计算原图哈希。
2. 经实际 ContentResolver 导入并读取这些 EXIF，运行 APK 内置 ML Kit 本地模型，生成视觉标签。
3. 打开原生 Activity 与本地编辑界面，修改署名、保存水印，关闭 Activity 后重新打开草稿。
4. 自动保存沉浸光感设置，使用编辑器的导出面板写入新的 MediaStore 相册文件。
5. 确认导出 URI 与原图不同、状态为 exported；删除编辑记录后原图哈希仍一致。
6. 截取并检查图库、相框编辑、沉浸光感编辑三张截图；修复 Android 15 系统栏覆盖内容的问题。

测试只清理自己创建的合成照片和导出图片，不重置照片库。截图保存在 `.test-artifacts/mobile/verification/`，未提交到 Git。

正式 APK：签名验证通过，ZIP 16KB 对齐通过，arm64 模型原生库 LOAD 段对齐为 16KB。最终清单无 INTERNET、ACCESS_NETWORK_STATE、WRITE_EXTERNAL_STORAGE、MANAGE_EXTERNAL_STORAGE。只申请相册读取权限，Android 14 部分授权由系统限定；禁止应用数据云备份和自动迁移。

本次重新检查正式 APK 的实际版本为 **1.0.0 / versionCode 1**，APK v2 签名有效，证书与之前一致。在 Android 15 专用 AOSP 模拟器覆盖安装、冷启动成功，release 没有 DEBUGGABLE 标志；用同一发布密钥签署独立测试 APK 后，在正式应用上运行 `IndependentAppTest` 通过完整草稿/导出/原图保护流程。测试 APK 不包含在发布附件；仅卸载重装模拟器测试包，不卸载正式应用或清除其数据库。单元测试 3 项通过，Lint 为 `No issues found`。AOSP 不具备 Google Play Protect，不能据此宣称实际手机绝无安装提示。

发布 Lint 设置为 warningsAsErrors，最终报告为 `No issues found`。导出按 JVM 可用内存预留空间并收紧尺寸，低空间时拒绝新增导出；相册引用与派生缓存分离。旧 Android 的代码使用基础集合及字符串 API，不依赖 Android 13 的 `String.isBlank`。

构建依赖和 target SDK 固定为本次验证的版本；Lint 的版本升级建议 `OldTargetApi` / `GradleDependency` 单独关闭，避免因构建机安装其他 SDK 或上游发布新版而使同一版本构建失效。其余 API 兼容性、权限与安全检查继续启用。后续发布到 Google Play 前应另行升级并验证其要求的 target SDK。

未测试实体手机、全部厂商的相册提供器、所有 Android 版本及所有 RAW/HEIC 编码组合；不能用模拟器结果代替这些兼容性检查。Android 独立库不共享桌面数据库，功能差异见 README。

## 重复验证

```powershell
.venv\Scripts\python.exe desktop/verify_package.py releases/windows/PhotoCollection/PhotoCollection.exe --ai
.venv\Scripts\python.exe desktop/verify_installer.py releases/PhotoCollection-Setup-2.1.1-x64.exe
.\build-android.ps1
```

仅在专用模拟器上运行设备测试：

```powershell
cd android
.\gradlew.bat assembleDebug assembleDebugAndroidTest
# 安装 app/build/outputs/apk/debug/app-debug.apk 和 androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5580 shell am instrument -w com.wonder.photo.test/androidx.test.runner.AndroidJUnitRunner
```

`.runtime/signing` 中的签名密钥和密码、照片库、预览与模型缓存均被 Git 忽略。公开 Windows ZIP 额外排除本机 `library-config.json`；正式 APK 不含测试图、桌面照片库或任何用户照片。
