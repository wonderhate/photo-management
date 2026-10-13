# 历史开发记录

这里保存当时的设计决策和验证证据。旧版本号、下载状态、目录或平台范围仅描述记录时的状态；当前功能以 [开发交接文档](../development-handoff-2026-10-13.md) 为准。旧安装包的校验值也仅对应当时构建，最终发行包以 GitHub Release 的 `SHA256SUMS.txt` 为准。

| 阶段 | 记录 |
| --- | --- |
| 原型与稳定性 | [MVP 验收](acceptance.md)、[六节计划](stabilization-plan.md)、[稳定性验证](verification.md) |
| Windows 与容器 | [应用验证](apps-verification.md)、[下载安全检查](apps-security.md) |
| UI 整合 | [界面设计](ui-design-2026-10-11.md)、[网页版重建](web-ui-rebuild-2026-10-11.md)、[Windows 同步](native-ui-sync-2026-10-11.md) |
| 水彩第一版 | [实现计划与用户提示词](watercolor-implementation-plan-2026-10-13.md)、[2.5.0 验证](watercolor-release-verification-2026-10-13.md) |
| 千问接入 | [2.5.1 接入验证](qwen-watercolor-verification-2026-10-13.md) |

旧 Express、Android、配对和远程访问代码可通过 Git 提交历史追溯，已不在当前源码树中。大篇幅外站截图分析和不可移植的本机截图链接已从当前文档树移除，相关 UI 决策已归纳到交接文档。
