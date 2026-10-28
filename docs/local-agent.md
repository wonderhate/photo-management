# 本地 Agent / MCP

这是融合开发分支的可选本机接口，默认关闭。设置中的「本地Agent / MCP」可以启用本次运行，分别允许读取、提交修改申请、提交国内AI上传与计费申请。服务重启后自动关闭，令牌不写入图库或设置备份。

## 连接与批准

启用后展开连接配置，把它交给可信的本机 MCP 客户端。地址使用当前本机服务的 `/mcp`，协议为 MCP 2025-06-18 Streamable HTTP。令牌放入 Authorization Bearer 请求头；不接受 URL 查询参数中的凭证。初始化后须发送 initialized 通知，并携带会话及协议版本头。

服务检查回环客户端、Host、Origin 和代理转发头。单请求最多256 KiB，每分钟最多120次，最多8个会话；会话闲置30分钟失效。该入口不提供公网、手机配对或远程连接。纯网页图库没有监听服务，只显示能力说明。

读取会形成活动记录。修改、导出、导航及控制申请进入活动中心，显示发起者、工具、照片范围、具体参数与审批摘要；批准后才执行。云端请求还需单独确认上传与计费，并使用已经在应用中配置的千问或火山账户，不接受工具传入密钥。取消已提交的云端请求不代表退款，也不会自动重试。

批准绑定当时的图库、原片哈希、元数据版本和相关工程版本。选区工具还绑定 focused 窗口及 selectionVersion，选区有效期15秒；大于100张的隐式选区被拒绝。修改后需重新申请。切换权限或轮换令牌会撤销旧请求。

## 37个工具族

| 范围 | 工具 |
| --- | --- |
| 图库、检索与预览 | `get_catalog_info`, `search_assets`, `get_asset`, `view_assets`, `list_tags`, `browse_map` |
| 应用选区与定位 | `get_selection`, `show_in_app` |
| 任务 | `get_job_status`, `list_active_jobs`, `cancel_job`, `pause_job`, `resume_job` |
| 照片整理 | `update_assets`, `delete_assets`, `set_asset_location`, `generate_previews` |
| 导入、影集及来源 | `manage_collections`, `import_directory`, `maintain_library`, `raw_pairing` |
| 人物与相似照片 | `list_people`, `get_person`, `update_person`, `index_people`, `find_similar`, `list_lookalikes`, `index_lookalikes` |
| 编辑与输出 | `get_editor_capabilities`, `crop_assets`, `export_assets`, `add_text`, `edit_asset`, `apply_frame`, `render_collage` |
| 国内AI | `annotate_assets`, `repaint_asset` |

参数以 `tools/list` 返回的严格 JSON Schema 为准；不提供任意 Python、SQL、Shell 或模型代码执行。读取预览每次最多四张、最长边256或512，移除元数据；返回结果有大小上限，完整文件路径和凭证字段不进入普通照片结果。

多动作工具的只读动作无需写权限，例如影集列表与详情、RAW候选和扫描目录列表。其余操作须经应用批准。`delete_assets` 只移除图库记录，不删除原片。目录导入保留原文件。`apply_frame` 创建现有摄影相框或沉浸光感草稿，不直接覆盖输出。

`crop_assets`、`add_text`、`edit_asset` 创建新的编辑工程；`export_assets` 从所选原始源的中性配方生成新的导出。要导出指定编辑参数，应先明确使用对应工程流程，不能把该工具误当成任意现存草稿的导出。`render_collage` 必须指定已保存工程的版本。

## 可见任务与恢复

界面导航、编辑和导出由聚焦的应用窗口领取单次执行令牌，调用同一暗房/拼图渲染器。未开应用或窗口未聚焦时保持等待，不在后端另造一个不一致的渲染实现。每3秒心跳；失联超过30秒会在后续状态检查时中断，已完成输出保留，不自动重放。

普通待批准申请10分钟后过期。暂停/恢复仅适用于尚未被领取的 Agent 请求；运行中的任务只能取消。模型推理取消终止对应进程或 Worker；其他任务按已有服务的安全检查点停止。活动中心可查看关联子任务及计费状态，重启恢复只记录中断，不重发云请求。

实现入口为 `mcp_routes.py`、`mcp_schemas.py`、`services/mcp_service.py`、`services/mcp_tools.py` 与前端 `workspace/AgentBridge.tsx`。当前测试使用隔离合成图库，不为用户图库自动开启 MCP，不调用付费AI。
