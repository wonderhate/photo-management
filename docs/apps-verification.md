# Windows 与本机网页容器应用验证（2026-10-11）


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


### 最终安全修订与发布包

上述 `f87671720352690e` 是界面修复阶段的构建。最终 2.1.1 发布包 build id 为 **`8c5460d4929c8d57`**，增加 PE 产品/版本信息、网页安全响应头，并更新 Transformers / Hub / cryptography。重新运行实际 EXE 的 16 项 HTTP 流程、721 个源文件哈希、WebView2 原生窗口以及离线 Chinese-CLIP 图像特征和中文搜索，均通过；搜索没有改写 embedding。ZIP 的 CRC、重复条目检查、build id、文档和私人文件排除检查通过。



### Windows 安装程序

使用 Inno Setup 7.1.0 制作 `PhotoCollection-Setup-2.1.1-x64.exe`，内含上述 build id `8c5460d4929c8d57` 的实际 EXE。Microsoft WebView2 引导程序打包前通过微软发布者 Authenticode 验证。

`desktop/verify_installer.py` 在专用临时安装目录实际通过：当前用户安装、两个开始菜单快捷方式、私人配置排除、同版本覆盖升级、用户配置/数据保留、安装后的 EXE 导入/EXIF/去重/统计/草稿/导出/原图保护，以及 WebView2 原生窗口 `window_loaded=true`。随后运行真实卸载器，确认程序、开始菜单与卸载注册移除，用户创建的配置及外部数据仍存在。测试拒绝覆盖账户内已有的正式安装；清理只作用于 `.test-artifacts` 下自己的目录，并处理 WebView2 长路径缓存。

本机已有 WebView2，未卸载系统运行库模拟缺失环境；自动安装运行库的分支经过编译与签名校验检查，但尚无干净虚拟机上的联网安装结果。安装程序仍未签名，未知发布者/SmartScreen 的限制不变。

## 网页容器 / GitHub Packages

[容器构建验证](https://github.com/wonderhate/photo-management/actions/runs/38099165258)通过。GitHub Linux runner 构建并运行实际 amd64 镜像，以非 root 用户启动，合成原图目录只读挂载；真实 HTTP 检查导入、草稿、环境光 PNG 导出、原图 SHA-256 不变、HTML CSP。镜像中没有私人配置、数据库或签名密钥。

工作流在 main 上验证后发布 `ghcr.io/wonderhate/photo-management:2.1.1` 和 `latest`，OCI source 标签关联当前仓库。基础镜像不包含桌面 AI / 人物识别依赖，也未验证 arm64。初次发布的可见性需单独设置为 Public；README 说明这一步，不能用 CI 推送成功代替匿名下载成功。数据库与派生文件使用独立数据卷，原图目录通过 Docker 的只读挂载保护。

## 重复验证

```powershell
.venv\Scripts\python.exe desktop/verify_package.py releases/windows/PhotoCollection/PhotoCollection.exe --ai
.venv\Scripts\python.exe desktop/verify_installer.py releases/PhotoCollection-Setup-2.1.1-x64.exe
```
