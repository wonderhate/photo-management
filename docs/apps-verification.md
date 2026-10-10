# Windows 与 Android 应用验证（2026-10-10）

Windows 独立程序：PyInstaller 6.22.3 / Python 3.12.10 / pywebview 6.2.1。Android 独立程序：AGP 8.9.2 / Gradle 8.11.1 / JDK 17 / compile & target SDK 35 / min SDK 29；模型随包安装。

## Windows

在生成的 `PhotoCollection.exe` 上运行 `desktop/verify_package.py`，测试库和输出全部隔离在 `.test-artifacts`，没有使用用户原图：

- 独立 EXE 启动、随机 localhost 端口、前端 HTML 与健康检查。
- 实际 JPG EXIF、重复导入、统计、创建水印草稿、正式导出、删除草稿和记录。
- `--ai` 读取已有模型缓存，实际加载 Chinese-CLIP CPU、生成 embedding、关键词检索。
- 测试原图前后 SHA-256 一致。
- 37 项原有后端测试通过；前端生产构建通过。

Windows 原生窗口交互及文件选择器还需要人工验收。Codex 内置浏览器目前无法连接真实浏览器会话；上述程序及 API 检查不等于桌面界面验收，未绕过此前浏览器权限限制。

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

发布 Lint 设置为 warningsAsErrors，最终报告为 `No issues found`。导出按 JVM 可用内存预留空间并收紧尺寸，低空间时拒绝新增导出；相册引用与派生缓存分离。旧 Android 的代码使用基础集合及字符串 API，不依赖 Android 13 的 `String.isBlank`。

未测试实体手机、全部厂商的相册提供器、所有 Android 版本及所有 RAW/HEIC 编码组合；不能用模拟器结果代替这些兼容性检查。Android 独立库不共享桌面数据库，功能差异见 README。

## 重复验证

```powershell
.venv\Scripts\python.exe desktop/verify_package.py releases/windows/PhotoCollection/PhotoCollection.exe --ai
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
