# Android 远程客户端

2026-10-11：Android 2.0.0 / versionCode 2 改为访问 Windows 2.2.0 照片库。本次为本机交付，尚未更新 GitHub Release 或容器包。

## 使用

1. 运行本次 Windows 包或更新后的源码服务：`./start.ps1 -Rebuild -Restart`。
2. 电脑设置页开启「手机远程访问」，查看 IP 地址、端口和八位配对码。
3. 安装 `releases/PhotoCollection-Android.apk`。手机与电脑连接同一 Wi-Fi 或私有 VPN，填写完整地址，例如 `http://192.168.1.20:8000`。Windows 防火墙若询问，允许专用网络访问；本次没有自动修改防火墙规则。
4. 配对码有效 10 分钟。配对成功后通过「连接已配对的电脑」重新进入，会话有效 30 天。电脑生成新码会撤销旧设备，关闭访问立即阻止手机请求。

电脑必须保持运行。当前支持局域网 IPv4 和私有 VPN IP（包括 100.64.0.0/10），未提供自动公网穿透、云中转或公网域名部署。HTTP 限于私有网络，不关闭 TLS 校验。

## 功能与存储

手机复用电脑 React 页面和 FastAPI 接口，底部提供照片、影集、创作、报告、我的。智能影集、时间线、人物和统计收进「我的」。手机布局使用红色强调、浅色底、圆角卡片及五栏导航，保留暗色模式。

照片收藏、评分、标签、批量操作、影集、人物、统计、AI、水印草稿与渲染均对电脑库执行。原始照片只读；删除图库只移除电脑记录。导入路径、文件选择器、原图打开和文件位置对应电脑。

手机仅持久化受限 JSON 索引、配对 Cookie、电脑地址和界面偏好。索引最多 60 项 / 3,000,000 个字符；在线读取更新快照，断网后已加载页面可读取已有索引，图片需在线获取。断网修改明确报错，不排队、不假装保存；冷启动仍需连接电脑加载界面。

WebView 禁用磁盘资源缓存，远程响应使用 `Cache-Control: no-store`；远程页面不注册 Service Worker，旧照片缓存被清除。预览仅在内存中显示，水印编辑不在手机创建正式图片。手机无需读取相册权限，不携带识别模型，不创建新的独立照片库。

单张导出后，电脑生成 JPG/PNG，手机从登记接口流式写入新相册文件 `Pictures/PhotoCollection`，不生成临时图片副本。批量导出使用每个作品自己的参数，任务完成后逐个点击结果链接保存到手机。仅接受当前电脑 `/api/exports/` 的 JPG/PNG，拒绝原图下载和外站链接。下载时以 `IS_PENDING` 隐藏未完成文件，失败只删除本次创建的相册记录。

覆盖升级保留原签名、旧独立库和已有相册导出，不自动迁移或删除它们。只清理旧应用生成的 `p*.webp` / `d*.webp` 派生预览。

## 隔离验证

- 后端：`./.venv/Scripts/python.exe -m pytest backend/tests -q`。
- 前端：`npm run build --prefix frontend`；`node --experimental-strip-types --test frontend/tests/*.test.*`。
- Android：`./build-android.ps1`，包括单元测试、Lint 和发布签名验证。
- 测试库：`./.venv/Scripts/python.exe -m backend.verify_remote_server`，端口 8012。固定配对码只用于 `.test-artifacts/remote-client` 合成库。
- 浏览器：测试库运行后，进入 `frontend` 执行 `node tests/remote-smoke.mjs`。
- 模拟器：`RemoteAppTest` 对正式 APK 验证配对、五栏导航、收藏、电脑草稿、预览、索引和相册导出；测试 APK 使用与目标 APK 相同的既有密钥签名。

测试使用专用模拟器与合成照片，不扫描或修改用户库。实体手机、OEM 相册、真实 VPN 和干净 Windows 防火墙环境仍需安装验收。此次未测试或发布 iOS。

## 本机交付结果

| 检查 | 2026-10-11 结果 |
| --- | --- |
| 后端回归 | 完整 45 项通过，最后远程访问与安全检查 5 项通过 |
| 前端 | 生产构建、4 项逻辑检查通过 |
| Chromium | 图库与另外 8 个页面，360 / 390 / 430 宽度无横向溢出；电脑草稿保存与恢复、索引缓存、断网修改拒绝通过 |
| Android 2.0.0 | 单元检查、Lint、正式 APK 签名通过；API 35 专用模拟器实际配对、导航、收藏、草稿、预览和手机相册导出通过 |
| Windows 2.2.0 | 实际打包 EXE 配对、电脑修改、草稿导出、图片禁止缓存、原图哈希、撤销访问及 ZIP 私人文件排除通过 |
| 安装器 | 2.2.0 编译成功；本次未在用户正式安装位置运行覆盖升级 |

本次文件在 `releases/PhotoCollection-Android.apk`、`releases/PhotoCollection-Setup-2.2.0-x64.exe` 和 `releases/PhotoCollection-Windows.zip`。校验见 `releases/SHA256SUMS.txt`；校验值用于完整性核对，不代替可信发布者签名。

界面预览使用合成照片，保存在 `verification/remote/`。测试服务器和本次启动的模拟器已在验证结束后关闭；用户照片库未用于这些测试。

## Windows 2.2.1 界面合并

Windows 分支 `codex/android-remote-desktop` 合入 `codex/netease-ui-redesign`：同步新版布局、浅色分区、完整英文界面、网页版图标、人物影集创建及自定义照片库和存储目录。Android 客户端保持 2.0.0，同一配对与导出协议继续使用。

本机 Windows 安装器为 `releases/PhotoCollection-Setup-2.2.1-x64.exe`，便携包为 `releases/PhotoCollection-Windows.zip`。开发分支未推送或公开发布；用户正式安装位置未用于覆盖升级测试。

2.2.1 实际打包 EXE 的配对、编辑、电脑草稿/导出、图片禁止缓存、源文件哈希和访问撤销通过；原生 WebView 成功加载。新版远程浏览器流程及 ZIP CRC/私人文件排除通过。Android APK 的 SHA-256 保持原值，校验文件同步记录新的 Windows 包。
