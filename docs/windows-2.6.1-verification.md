# Windows 2.6.1 交付验证

日期：2026-10-16。应用版本：2.6.1。构建标识：`27fed1b441856d7d`。

## 问题与修正

实际 2.6.0 安装版已包含批量接口和新前端，上传两张合成照片可进入批量流程。但初始页面沿用「上传照片」「从一张旅行照片开始」，可选 AI 标题在选中两张前完全隐藏，难以发现新功能。

2.6.1 首页直接显示「批量上传照片」、Ctrl / Shift 多选及每批最多 100 张说明；可选 AI 标题始终可见，选中两张及以上后启用且默认关闭。单张手动标题、原图只读、先图片后标题及失败/取消保留作品的行为保持一致。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 78 项通过 |
| `npm run test:frontend` | 发行源码 5 项通过 |
| `npm run build` 与 Windows EXE 构建 | 通过 |
| `npm run test:browser` | 36 项通过，含中英文、明暗主题、窄屏及一张切换为两张 |
| `python -m unittest desktop.test_icon` | 1 项通过 |
| `desktop/verify_package.py` | 实际 EXE、授权、凭证、排版、导出、原图哈希及成品界面检查通过 |
| `desktop/verify_installer.py` | 安装、快捷方式、覆盖升级、实际 WebView2 启动、卸载及配置/照片库保留通过；安装后的前端资源再次通过界面检查 |

新增的 `desktop/verify_watercolor_ui.mjs` 连接实际 EXE 的回环服务，在 Chromium 中加载包内前端，检查初始批量入口、常驻标题选项、多文件上传、默认 `generate_titles=false`、显式开启后为 `true`，并拦截全部 AI 生成请求。界面截图仅存于隔离测试目录，不进入 Git 或安装包。

当前工作目录保留的浏览器开发工作未混入 Windows 发行分支；其中 Windows 界面修正和版本信息已同步，另通过 11 项前端逻辑检查及生产构建。

## 文件校验

| 文件 | SHA-256 |
| --- | --- |
| `PhotoCollection-Setup-2.6.1-x64.exe` | `ba0b0b8a7e35b6f3cb4ee4c4c6949de2fd5ea92d50d21d728780d4d2114de2be` |
| `PhotoCollection-Windows.zip` | `2c56d6df1ab15c300ba14931776d1f7718833e7c659f6f74192e9455dff8c6be` |

发布文件与 `SHA256SUMS.txt` 见 [v2.6.1 Release](https://github.com/wonderhate/photo-management/releases/tag/v2.6.1)。源码 MIT 授权随两种 Windows 包分发，原有字体授权及来源记录保留。

## 未覆盖范围

未调用付费生成或标题服务，未上传私人照片；真实账户权限和水彩画质未实测。所有自动化验收使用隔离的合成照片与测试库，原文件哈希不变。
