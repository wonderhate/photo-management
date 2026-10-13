# 水彩转绘 2.5.0 本地交付验证

日期：2026-10-13。分支：`codex/ai-watercolor`。构建标识：`6862fb81443633cd`。

## 交付文件

- 安装包：`releases/PhotoCollection-Setup-2.5.0-x64.exe`，265235249 字节。
- 安装包 SHA-256：`17F42818878E656F9E9F5A0A7BBE51077CB300345B9E05C627788D87B8179A7E`。
- 便携包：`releases/PhotoCollection-Windows.zip`，300502675 字节。
- 使用说明：`docs/watercolor-usage.md`，同时包含在发行包中。

## 已验证

- 后端全量 64 项、前端单元检查 5 项、浏览器全量 33 项通过；TypeScript 与生产构建通过。
- 水彩作品可进入水印工坊。预览、编辑、复制和导出固定使用发送时已保存的海报版本；后续修改海报或删除原照片库记录不会改变该来源。库迁移包含所引用的海报文件。
- 旧数据库增加水印作品关联字段，迁移可重复执行，已有水印记录保留。
- 实际 Windows EXE：启动、EXIF、去重、统计、水印草稿和安全删除通过；水彩页面、Windows DPAPI 密钥保存和清除、中文标题本地排版、海报导出及水印联动通过。
- 安装包：隔离目录安装、快捷方式、配置保留、覆盖升级、安装后实际 EXE 和原生窗口通过；卸载移除程序及快捷方式，保留配置与测试数据。
- 便携包共 6310 个条目，包含水彩说明，未包含 `library.db`、`art-key.dpapi` 或 `library-config.json`。构建未启用私人照片库打包选项。
- `git diff --check` 通过。验证脚本已兼容 Windows 系统命令编码，并显式关闭测试 SQLite 连接，避免清理时占用数据库文件。

## 复验命令

在项目根目录的 PowerShell 中执行：

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
node --experimental-strip-types --test frontend/tests/*.test.ts frontend/tests/sw.test.mjs
npm run build --prefix frontend
npx --prefix frontend playwright test --config frontend/playwright.config.ts
.venv/Scripts/python.exe desktop/verify_package.py
.venv/Scripts/python.exe desktop/verify_installer.py releases/PhotoCollection-Setup-2.5.0-x64.exe
```

安装验证脚本要求当前用户没有已注册的安装副本，发现已有安装时会停止，避免覆盖用户应用。

## 尚未验收的范围

没有调用真实云端图像生成、没有上传私人照片、没有产生图像 API 费用。生成测试使用模拟服务，Windows 排版测试使用明确的合成色块图片；这些结果不代表真实水彩画质已达标。需配置自己的可用 API Key 后，用人像、建筑和风景样片人工检查主体保留及自然水彩效果。

此次交付仅生成本地安装包并保存在开发分支，未合并 `main`、推送 GitHub 或发布 Release。
