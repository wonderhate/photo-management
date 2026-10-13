# 下载、安装与安全检查（2026-10-11）


## 本次修复

- Windows EXE 增加实际 PE 文件说明、产品名、版本号，关闭打包器的 UPX 压缩；这些便于检查文件身份，但不等同于可信签名。
- AI 依赖从 Transformers 4.57.6 / Hub 0.36.2 更新到 5.10.4 / 1.33.0；桌面依赖 cryptography 固定为 50.0.0。扫描发现旧版本的安全公告，升级后的 69 个已安装 Python 包复扫为 0 个已知漏洞。没有忽略公告或关闭证书校验。扫描库会更新，此结论仅代表本次检查。
- 适配 Transformers 5 的 `pooler_output` 特征结果，移除旧版文本池化临时修正。只在本地加载 Chinese-CLIP，显式禁用远程模型代码；离线图像特征、中文搜索及搜索复用缓存验证通过。
- 网页保留 localhost Host 与跨站写操作检查，增加 `nosniff`、禁止被其他页面嵌入、关闭 Referrer，以及生产 HTML 的 CSP。Swagger 文档保留其自带脚本需求。Chromium 回归改为由真实 FastAPI 提供生产前端，数据仍为合成 API 响应，因此也检查 CSP 是否破坏正常界面。
- 已修复另一台电脑报告的浅色影集/人物卡片及 Windows PowerShell 5.1 编码、中文配置路径问题，见 [应用验证](apps-verification.md)。

依赖公告依据：[Transformers 路径写入公告](https://github.com/advisories/GHSA-xrqw-3rrv-vx5w)、[cryptography 维护者公告](https://github.com/pyca/cryptography/security/advisories/GHSA-g6cj-pr64-35w5)。升级修复版本匹配，并不表示本程序实际暴露了公告中的训练、邮件解密或生成模型入口。

## Windows 下载和启动


安装器与应用 EXE 都仍未签名。安装器内的 Microsoft WebView2 引导程序来自微软官方地址，打包前检查 Authenticode 为 `Valid`、发布者为 Microsoft Corporation；这不等于整个安装器获得微软签名。已有运行库时跳过安装，缺少时联网安装，失败则中止并提示。测试电脑已有 WebView2，未卸载系统运行库来模拟缺失环境。

目前 EXE 的 Authenticode 状态仍为 **NotSigned**。本机 Microsoft Defender 已对发布目录执行自定义扫描，未发现该目录的威胁；实时保护保持开启。最终发布包另行重复扫描。没有使用白名单、自签根证书、关杀毒或自动解除文件来源标记。

**可能出现的提示仍然存在：** 浏览器下载信誉警告、“未知发布者”、SmartScreen，或开启 Smart App Control 的设备拒绝运行。它们与防病毒扫描是不同的判断。本机从构建目录启动成功，不能代替互联网下载后在其他设备上的 SmartScreen 结论；本次未实测全部浏览器、Smart App Control 策略或企业管理策略。[Microsoft 的信誉规则](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)也说明新签名文件可能仍需积累信誉。

要解决发布者身份，需要：

1. 获得受 Windows 信任的代码签名证书，或符合条件的 Microsoft Artifact Signing 账号，完成身份验证；自签证书不能解决公众安装的信任问题。
2. 在构建完成后对应用 EXE、安装器及自己制作的二进制签名并使用可信时间戳，然后检查 `Get-AuthenticodeSignature` 为 `Valid`；重新打 ZIP 并更新 SHA-256。安装程序的卸载器也需在 Inno Setup 构建时按签名配置处理。
3. 如果希望通过商店安装，还需 Microsoft Store 发布账号、适用的打包方式及审核。不要把有签名等同于保证无 SmartScreen 提示。见 [Microsoft 签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)。

收到明确的恶意软件告警时，保留文件哈希、截图与产品名称，并向相应厂商提交误报复核；不要按“未知发布者”的步骤处理恶意软件告警。



```text
71b13ac9dfb9555d3ff0412df1b2585b620b4573e043f0b78f0c8e9c4c7d7c33
```





## 本机访问边界

2.4.0 起仅提供 Windows 与本机网页版。桌面启动器和源码启动脚本监听 `127.0.0.1`；手机客户端、配对码、公网地址登记、设备会话、手机索引缓存和相册导出桥接均已移除。旧设备会话不再被读取或用于授权，已有照片库和原图不受影响。

服务只接受 localhost、回环地址和测试主机名；私网或公网 Host 被拒绝，带转发标记的请求也被拒绝，跨站写操作继续检查 Origin。保留 CSP、nosniff、禁止嵌入页面和关闭 Referrer。不要通过代理、隧道或端口转发将本机服务发布到网络。Docker 必须用 `127.0.0.1:8000:8000` 发布端口，容器内部监听全部接口仅用于容器网络转发，不代表提供远程访问。

## 用户可重复检查

```powershell
# 下载包完整性：与同一 Release 的 SHA256SUMS.txt 比较
Get-FileHash .\PhotoCollection-Windows.zip -Algorithm SHA256
Get-FileHash .\PhotoCollection-Setup-2.1.1-x64.exe -Algorithm SHA256
# Windows 当前应显示 NotSigned，未来可信签名后应为 Valid
Get-AuthenticodeSignature .\PhotoCollection.exe
Get-AuthenticodeSignature .\PhotoCollection-Setup-2.1.1-x64.exe
```

开发时：`python -m pytest backend/tests -q`；`desktop/verify_package.py <EXE路径> --ai` 验证实际 EXE 的 PE 版本、安全响应头、离线 AI 及原图保护。前端 `npx playwright test` 需要先安装测试专用 Chromium，并先完成生产构建；Windows 可设置 `PHOTO_TEST_PYTHON` 为项目 `.venv\Scripts\python.exe` 的绝对路径。这些测试均使用隔离数据。
