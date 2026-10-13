# 千问水彩转绘 2.5.1 验证记录

> 历史记录：功能、下载状态和校验值对应当时版本。当前说明见 [文档索引](../README.md)。

日期：2026-10-13。分支：`codex/ai-watercolor`。构建标识：`3584bd48e2fce08f`。

## 交付

- 安装包：`releases/PhotoCollection-Setup-2.5.1-x64.exe`，265238731 字节。
- SHA-256：`199627A576FFCB7475DBDA986D1DC80ACE6327B8934B849E9AF343A2A5B4A2AE`。
- 便携包：`releases/PhotoCollection-Windows.zip`，300507442 字节。
- 使用说明：`docs/watercolor-usage.md`，已包含在发行包中。

## 修改

使用用户提供的 `https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation`，请求遵循 DashScope 同步多模态 JSON 协议。图像模型可选 `qwen-image-3.0` 或 `qwen-image-3.0-pro`，后者是文档中的 Pro 模型名称。保存设置后，新生成任务采用所选模型，历史作品的模型记录和图像保留。

转绘请求同时发送原图 Base64 和水彩指令，指定一张图片、输出尺寸和关闭水印。草图关闭提示词优化，标准启用优化，精细同时启用模型思考。返回的生成图片先下载并保存，再使用现有本地纸面排版和文字渲染流程；原图比例检查、取消、导出和水印联动保持有效。

标题建议使用同一网关的千问视觉模型，默认 `qwen3-vl-plus`，可在设置中修改。该网关是否开放此模型仍取决于实际账户；用户可以直接手动填写标题。

千问凭证独立保存为 `qwen-art-key.dpapi`，使用 Windows 当前用户的 DPAPI 加密，也支持 `DASHSCOPE_API_KEY` 环境变量。不会读取或复用旧版 OpenAI Key。旧版图像和标题模型设置自动迁移为千问默认值，其它设置保留；存储迁移包含新的千问凭证文件。

错误提示按已知服务错误码区分余额/配额、限流、密钥和模型参数问题，提供中英文提示；不会输出原始响应正文、密钥或自动重试生成。生成图片下载不转发 API 授权头，不自动跟随重定向，只接受网关或阿里云对象存储的 HTTPS 结果地址及图片 Base64。

## 验证结果

- 后端全量 74 项通过，包含两种模型请求、质量参数、旧凭证隔离、旧设置迁移、图片响应与下载、错误提示脱敏、无自动重试及已有作品流程。
- 前端单元检查 5 项、浏览器全量 33 项通过；TypeScript 和生产构建通过。水彩场景覆盖浅色中文、深色英文及窄屏英文，验证模型选择与保存、英文设置窗口、排版、导出和水印联动。
- 实际 Windows EXE：千问接口与模型设置、Pro 模型保存、DPAPI 密钥保存和清除、中文排版、图片导出、水印联动及既有照片库检查通过。
- 安装包：安装、快捷方式、配置保留、覆盖升级、安装后实际应用与原生窗口通过；卸载保留配置和测试数据。
- 便携包共 6310 个条目，未包含照片库数据库、私人路径配置或两种服务的密钥文件。`git diff --check` 通过。

这些是协议模拟、合成图片和本地应用测试。没有调用真实千问生成，没有上传私人照片或产生生图费用；实际网关权限、余额和水彩画质需配置对应服务的有效密钥后验收。

## 复验

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
node --experimental-strip-types --test frontend/tests/*.test.ts frontend/tests/sw.test.mjs
npm run build --prefix frontend
npx --prefix frontend playwright test --config frontend/playwright.config.ts
.venv/Scripts/python.exe desktop/verify_package.py
.venv/Scripts/python.exe desktop/verify_installer.py releases/PhotoCollection-Setup-2.5.1-x64.exe
```

安装验证要求当前用户没有已注册的安装副本，脚本会先检查，以免覆盖现有应用。

协议参考：[千问图像生成与编辑](https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference)、[千问视觉模型 DashScope 协议](https://www.alibabacloud.com/help/en/model-studio/multi-round-conversation)。用户指定的网关地址按其提供的调用示例接入，未将其认定为阿里云官方域名。
