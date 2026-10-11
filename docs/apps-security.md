# 下载、安装与安全检查（2026-10-11）

范围：Windows 2.1.1、Android 独立版 1.0.0、localhost 网页；iOS 暂停。所有可写验证使用专用模拟器及合成照片，不修改用户原图。这里区分程序检查与系统的发布者身份、信誉判断；通过扫描不代表所有电脑或手机都不会提示。

## 本次修复

- Windows EXE 增加实际 PE 文件说明、产品名、版本号，关闭打包器的 UPX 压缩；这些便于检查文件身份，但不等同于可信签名。
- AI 依赖从 Transformers 4.57.6 / Hub 0.36.2 更新到 5.10.4 / 1.33.0；桌面依赖 cryptography 固定为 50.0.0。扫描发现旧版本的安全公告，升级后的 69 个已安装 Python 包复扫为 0 个已知漏洞。没有忽略公告或关闭证书校验。扫描库会更新，此结论仅代表本次检查。
- 适配 Transformers 5 的 `pooler_output` 特征结果，移除旧版文本池化临时修正。只在本地加载 Chinese-CLIP，显式禁用远程模型代码；离线图像特征、中文搜索及搜索复用缓存验证通过。
- 网页保留 localhost Host 与跨站写操作检查，增加 `nosniff`、禁止被其他页面嵌入、关闭 Referrer，以及生产 HTML 的 CSP。Swagger 文档保留其自带脚本需求。Chromium 回归改为由真实 FastAPI 提供生产前端，数据仍为合成 API 响应，因此也检查 CSP 是否破坏正常界面。
- 已修复另一台电脑报告的浅色影集/人物卡片及 Windows PowerShell 5.1 编码、中文配置路径问题，见 [应用验证](apps-verification.md)。

依赖公告依据：[Transformers 路径写入公告](https://github.com/advisories/GHSA-xrqw-3rrv-vx5w)、[cryptography 维护者公告](https://github.com/pyca/cryptography/security/advisories/GHSA-g6cj-pr64-35w5)。升级修复版本匹配，并不表示本程序实际暴露了公告中的训练、邮件解密或生成模型入口。

## Windows 下载和启动

Release 提供 Windows 中文安装程序、便携 ZIP、Android APK 与 `SHA256SUMS.txt`。安装程序按当前用户安装，提供快捷方式、覆盖升级和卸载；不要求管理员权限。公开包不含本机照片库配置、数据库、模型权重、签名密钥或用户照片。便携版解压后运行 `PhotoCollection.exe`，须保留同目录 `_internal`。

安装器与应用 EXE 都仍未签名。安装器内的 Microsoft WebView2 引导程序来自微软官方地址，打包前检查 Authenticode 为 `Valid`、发布者为 Microsoft Corporation；这不等于整个安装器获得微软签名。已有运行库时跳过安装，缺少时联网安装，失败则中止并提示。测试电脑已有 WebView2，未卸载系统运行库来模拟缺失环境。

目前 EXE 的 Authenticode 状态仍为 **NotSigned**。本机 Microsoft Defender 已对发布目录执行自定义扫描，未发现该目录的威胁；实时保护保持开启。最终发布包另行重复扫描。没有使用白名单、自签根证书、关杀毒或自动解除文件来源标记。

**可能出现的提示仍然存在：** 浏览器下载信誉警告、“未知发布者”、SmartScreen，或开启 Smart App Control 的设备拒绝运行。它们与防病毒扫描是不同的判断。本机从构建目录启动成功，不能代替互联网下载后在其他设备上的 SmartScreen 结论；本次未实测全部浏览器、Smart App Control 策略或企业管理策略。[Microsoft 的信誉规则](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)也说明新签名文件可能仍需积累信誉。

要解决发布者身份，需要：

1. 获得受 Windows 信任的代码签名证书，或符合条件的 Microsoft Artifact Signing 账号，完成身份验证；自签证书不能解决公众安装的信任问题。
2. 在构建完成后对应用 EXE、安装器及自己制作的二进制签名并使用可信时间戳，然后检查 `Get-AuthenticodeSignature` 为 `Valid`；重新打 ZIP 并更新 SHA-256。安装程序的卸载器也需在 Inno Setup 构建时按签名配置处理。
3. 如果希望通过商店安装，还需 Microsoft Store 发布账号、适用的打包方式及审核。不要把有签名等同于保证无 SmartScreen 提示。见 [Microsoft 签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)。

收到明确的恶意软件告警时，保留文件哈希、截图与产品名称，并向相应厂商提交误报复核；不要按“未知发布者”的步骤处理恶意软件告警。

## Android 下载和安装

实际发布 APK：`com.wonder.photo`，版本 **1.0.0 / versionCode 1**，min SDK 29，target SDK 35；release 不含 DEBUGGABLE 标志。APK v2 签名验证通过。发布证书 SHA-256：

```text
71b13ac9dfb9555d3ff0412df1b2585b620b4573e043f0b78f0c8e9c4c7d7c33
```

Android 使用应用自身的发布密钥属于正常分发机制，与 Windows 自签证书的信任机制不同。后续 APK 必须保留这一密钥；密钥和密码只保存在 Git 忽略的 `.runtime/signing` 中，需安全备份，绝不能上传 GitHub。开发者验证需要证明包名/证书归属，不能上传私钥。

权限只有相册读取和 Android 14 部分相册授权，以及 AndroidX 的应用内部接收器权限。无 INTERNET、网络状态、相册写入、全盘管理、短信、无障碍或通知监听权限；不启用云备份和明文网络。签名、16KB 对齐、Lint、单元测试，以及正式 APK 在 Android 15 AOSP 专用模拟器上的覆盖安装、启动和完整编辑/导出测试通过；测试只处理自己生成的相册素材。

侧载时系统通常要求用户允许该下载来源安装 APK；Google Play Protect 可能要求扫描此前未识别的应用。这不是 APK 缺少签名，也不能通过代码保证消失。专用 AOSP 模拟器没有 Play Protect，因此本次**没有测得** Google 云端信誉判定或各手机厂商的实际拦截结果。依据 [Google 的提示说明](https://developers.google.com/android/play-protect/warning-dev-guidance)，不添加所谓安装助手，不关闭安全扫描。

后续仍需 Android Developer Console 或 Play Console 的开发者验证账号、身份验证、包名与当前发布证书登记；截至本次检查，Google 的验证要求在首批地区推行，后续扩展，不能说全球所有设备都已经强制拦截。商店发布还需满足当时的 target SDK 与审核要求。见 [Android 开发者验证](https://developer.android.com/developer-verification)。实体手机、Play Protect 和厂商商店的安装验收需要具备这些环境后完成。

## 用户可重复检查

```powershell
# 下载包完整性：与同一 Release 的 SHA256SUMS.txt 比较
Get-FileHash .\PhotoCollection-Windows.zip -Algorithm SHA256
Get-FileHash .\PhotoCollection-Setup-2.1.1-x64.exe -Algorithm SHA256
Get-FileHash .\PhotoCollection-Android.apk -Algorithm SHA256
# Windows 当前应显示 NotSigned，未来可信签名后应为 Valid
Get-AuthenticodeSignature .\PhotoCollection.exe
Get-AuthenticodeSignature .\PhotoCollection-Setup-2.1.1-x64.exe
```

开发时：`python -m pytest backend/tests -q`；`desktop/verify_package.py <EXE路径> --ai` 验证实际 EXE 的 PE 版本、安全响应头、离线 AI 及原图保护。前端 `npx playwright test` 需要先安装测试专用 Chromium，并先完成生产构建；Windows 可设置 `PHOTO_TEST_PYTHON` 为项目 `.venv\Scripts\python.exe` 的绝对路径。这些测试均使用隔离数据。
