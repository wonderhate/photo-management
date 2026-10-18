# Linux 桌面版（首版）

日期：2026-10-18。范围：只做 Linux x64。macOS 不在本次范围内。

## 与 Windows 版的关系

同一个后端（FastAPI）、同一份前端构建产物，只有窗口壳按平台切换：

| 平台 | 窗口后端 | pywebview `gui` | 说明 |
| --- | --- | --- | --- |
| Windows | WebView2 | `edgechromium` | 不变 |
| macOS（未做） | WKWebView | `cocoa` | 代码已分支，未验证 |
| Linux | QtWebEngine | `qt` | 本次新增 |

选 Qt 而不是 GTK：GTK 需要系统装 `libwebkit2gtk-4.1` 且 PyGObject 要编译；QtWebEngine 随包分发（`pywebview[qt]`），用户机器不用装 WebView。

## 代码改动

- `desktop/launcher.py`：`gui_backend()` 按平台选择；`state_dir()` 统一用户目录（`%LOCALAPPDATA%` / `~/Library/Application Support` / `$XDG_STATE_HOME` 或 `~/.local/state`）；全屏跟随仅 Windows（只有 WebView2 提供该事件）；崩溃弹窗仅 Windows，其他平台写日志。
- `backend/app/config.py`：`state_root()` 同上，冻结包的 `USER_ROOT` 按平台。
- `backend/app/main.py`：`reveal` 用 `explorer /select`（Win）、`open -R`（mac）、`xdg-open`（Linux）；`open` 同理。
- `backend/app/dialog.py`：tkinter 不可用时（冻结的 Linux 包通常没有）退回 PyQt6 `QFileDialog`。
- `desktop/PhotoCollection.spec`：分离 Windows 的版本资源与图标分支；Linux 不排除 PyQt6、改用 `webview.platforms.qt`。
- `desktop/requirements.txt`：Linux 安装 `pywebview[qt]`，其他平台保持原样。
- `build-linux.sh`、`desktop/verify_linux.py`、`.github/workflows/linux-release.yml`：构建、验收、CI。

## 构建

```bash
python3.12 -m venv .venv-linux
.venv-linux/bin/pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu
.venv-linux/bin/pip install -r backend/requirements.txt -r backend/requirements-ai.txt \
  -r backend/requirements-faces.txt -r desktop/requirements.txt
npm --prefix frontend ci
bash build-linux.sh          # -> releases/linux/PhotoCollection, releases/PhotoCollection-Linux-<ver>-x64.tar.gz
```

CI（`linux-release.yml`）跑在 `ubuntu-22.04`：glibc 2.35 是兼容下限，用 24.04 构建会让 22.04 用户装不上。产物是 `.tar.gz`，不是 AppImage——AppImage 依赖 FUSE，且打包 GTK/Qt 插件更容易出问题，首版先发 tar.gz。

## 验证

`desktop/verify_linux.py` 用冻结包自身跑一遍真实链路（不依赖开发环境）：

- `--serve` 启动打包后的可执行文件，`--status-file` 拿到端口后连 HTTP
- 导入一张合成 JPEG → 等 job 完成 → 读回尺寸
- 建水印草稿并导出 PNG
- 校验原图 SHA-256 未变（原图只读）
- 首页 HTML 与 `frame-ancestors 'none'` CSP 头

`--window-check` 在 `xvfb-run` 下真正创建 QtWebEngine 窗口，页面 `loaded` 事件后写 `window_loaded: true`，自证 UI 渲染成功（不只是进程活着）。

CI 还会检查包里没有 `*.dpapi`、`library.db`、`library-config.json`。

首次实跑（run 39122289744）结果：打包与验收通过（`linux bundle OK: import, job, preview, watermark export, CSP, original hash`），窗口步骤失败在 `could not load the Qt platform plugin "xcb"`——Qt ≥ 6.5 需要 `libxcb-cursor0`。已补进 CI 依赖，并加了 xvfb 下的截图产物。

Linux 桌面包需要的系统库（普通桌面发行版自带，无桌面/服务器环境要手装）：
`libgl1 libegl1 libxkbcommon-x11-0 libnss3 libxcomposite1 libxdamage1 libxrandr2 libxtst6 libasound2 libfontconfig1 libdbus-1-3 libxcb-cursor0`

## 体积

| 平台 | 解包后 | 发布包 |
| --- | --- | --- |
| Windows（现有） | 790 MB | 安装包 265 MB / ZIP 300 MB |
| Linux（本次） | 1.68 GB | tar.gz 596 MB |

多出来的主要是 `PyQt6`（452 MB，含 QtWebEngine）和它带来的 Qt 运行时。这是"用户机器不装 WebKitGTK"的代价。如果体积优先，可以换 GTK 后端（包小一半，但要求系统有 `libwebkit2gtk-4.1` 和 PyGObject），本次没做。

## 已知限制（首版）

1. **API Key 不能界面保存**：`services/art_credentials.py` 的加密用的是 Windows DPAPI，非 Windows 平台只能读环境变量 `DASHSCOPE_API_KEY`，设置里不显示"保存 Key"。要补齐需要接 libsecret/Keychain。
2. **全屏跟随只在 Windows**：Linux 上页面内全屏不影响窗口。
3. **体积更大**：QtWebEngine 会比 Windows 包多两三百 MB。
4. **没做 AppImage / deb / rpm**：只发 tar.gz，首次需要 `chmod +x`。
5. **没做代码签名**：Linux 无强制签名，但下载校验值要公布。
6. **faiss**：x64 有 wheel，语义检索完整可用；没有 arm64 产物（本次不含 arm64）。

## 故障排查

- 白屏/启动即退：看 `~/.local/state/PhotoCollection/logs/desktop.log`。
- `Could not find the Qt platform plugin "xcb"`：缺 `libxkbcommon-x11-0`、`libxcb-*`。
- 无显示环境跑 CI：必须 `xvfb-run`，并设 `QTWEBENGINE_CHROMIUM_FLAGS='--no-sandbox --disable-gpu'`。
- 旧发行版报 `GLIBC_2.xx not found`：产物不是 22.04 基线的，重建。
