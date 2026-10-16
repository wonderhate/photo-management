# Windows 2.6.0 交付验证

日期：2026-10-16。应用版本：2.6.0。构建标识：`90b8bef60e0baeae`。

本次交付修复历史失败任务在水彩页反复提示的问题，增加最多 100 张照片的后台批量转绘，以及默认关闭的逐张 AI 标题。先完成全部图片，再为成功作品生成并应用标题；失败和取消均保留已完成作品，不自动重试付费请求。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm test` | 78 项通过 |
| `npm run test:frontend` | 5 项通过 |
| 生产构建及 Windows EXE 构建 | 通过 |
| `npm run test:browser` | 36 项通过，含中英文、明暗主题、窄屏与批量上传 |
| `python -m unittest desktop.test_icon` | 1 项通过 |
| `desktop/verify_package.py` | 成品启动、回环监听、批量接口及标题默认关闭、MIT 授权文件、EXIF、去重、统计、Windows 凭证加密、中文排版、导出及水印联动通过 |
| `desktop/verify_installer.py` | 安装、快捷方式、实际 WebView2 启动、覆盖升级、卸载及配置/照片库保留通过 |

安装包和便携包内的 README 已更新至 2.6.0 下载链接，并附带与仓库逐字节一致的 MIT `LICENSE`（Copyright (c) 2026 wonderhate）。重新封装后的最终安装包再次通过安装、升级及卸载验证。

测试使用隔离的合成照片库，并检查原文件哈希不变。便携包未包含私人配置、数据库、凭证或模型权重；8 份字体授权和资产来源记录保持原始字节。

## 文件校验

| 文件 | SHA-256 |
| --- | --- |
| `PhotoCollection-Setup-2.6.0-x64.exe` | `3b0bcbffb958b16a08fd59c42f4456d718b017baffd0cfbb162f0c6a292f1072` |
| `PhotoCollection-Windows.zip` | `f9bc3c45f6c62adc0e18c0c2eef7924a888974f89afccecf58246b5b276ae796` |

发布文件与 `SHA256SUMS.txt` 一并提供于 [v2.6.0 Release](https://github.com/wonderhate/photo-management/releases/tag/v2.6.0)。

## 未覆盖范围

千问生图和标题请求使用模拟响应验证协议与流程，未调用付费接口或上传私人照片；真实账户权限和水彩画质尚未实测。本次没有重新交付本地模型权重或执行真实模型性能验收。
