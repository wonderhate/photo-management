# 开发与贡献

当前版本为 2.7.2（公开试用）。先阅读 [开发交接文档](docs/development-handoff-2026-10-13.md)，再从最新 `main` 创建 `codex/` 功能分支。历史计划位于 `docs/history/`，不代表当前产品范围。

## 本地开发

需要 Python 3.12+、Node.js 22.12+；CI 使用 Python 3.12 和 Node.js 24。

```powershell
.\start.ps1 -Install
# 编辑代码后重新构建和启动受管理的服务
.\start.ps1 -Rebuild -Restart
```

如果 8000 端口被另一份程序占用，先确认服务归属和照片库路径。启动脚本拒绝替换不匹配的实例，不要直接终止所有 Python 进程。

## 回归检查

```powershell
npm test
npm run test:frontend
npm run build
npm run test:browser
.venv/Scripts/python.exe -m unittest desktop.test_icon
git diff --check
```

首次运行浏览器检查需要 `npx --prefix frontend playwright install chromium`。后端与浏览器测试使用 `.test-artifacts/` 下的合成照片库。原图处理、导出或迁移变更需验证源文件哈希与失败回滚；界面改动需检查中英文、明暗主题和窄屏。

真实水彩生图需要服务账户、有效密钥和明确选定的测试照片。模拟响应只能验证协议和流程，不能标为真实画质验收。不要把密钥放进测试代码、截图、Issue 或日志。

## 提交与发布

- 提交应说明问题、最终行为及相关验证；避免混入私人数据或无关格式改动。
- 数据库升级沿用 `backend/app/migrations.py` 的备份和幂等迁移机制。
- 更新应用版本时同步 `backend/version.py`、根目录及前端 `package.json` 和锁文件，并更新 CHANGELOG。
- Windows 包由 `build-windows.ps1` 和 `build-installer.ps1` 构建。分发不得使用私人照片库配置；安装验证请使用未安装正式副本的测试账户。
- `.github/workflows/windows-release.yml` 仅向已有草稿上传验证过的包；容器发布由主分支手动运行 `Web package`，Windows Release 不会自动覆盖镜像。
- 项目代码采用根目录 [MIT License](LICENSE)。保留该授权、字体 OFL 文本及品牌图案来源记录；第三方资源沿用各自授权。

提交前检查 `git status`，确认 `.env*`、DPAPI 凭证、数据库、原片、模型和本机绝对路径配置未被提交。
