# 光影集网页版上线交接文档

整理日期：2026-10-17（北京时间）。应用与本次发布包版本：**2.6.1**。

本文汇总本次对话中的路线选择、实际部署、用户验收与运维配置，并纳入交接时的只读复核。目标读者包括网站所有者、后续开发者和运维接手者。凭据由用户独立保管，本文不包含密码、API Key、私钥内容、个人照片或图库。

## 1. 当前结论

**网站与新加坡 AI 中转已上线，基础配置及核心使用流程已经通过检查，可以进入小范围试用。**

用户已实际完成新建本地图库、导入照片、关闭网页后重开、真实水彩生成、作品下载、作品重开和独立备份恢复。余额预警、流量告警及财务到期通知已按指引配置并反馈完成。

这不等于 Windows 版全部功能、所有浏览器、大图库性能、长时间 AI 请求及国内外所有网络均已验收。后续事项见第 11 节。

| 项目 | 当前状态 |
| --- | --- |
| 正式网站 | [https://photomanagement.online/](https://photomanagement.online/)，HTTPS 返回 200 |
| HTTP 跳转 | 已开启强制 HTTPS；本轮复核为 301，保留路径和查询参数 |
| AI 中转 | wss://ai.photomanagement.online/cloud-art，已部署并通过公网连接检查 |
| 中转健康检查 | [https://ai.photomanagement.online/health](https://ai.photomanagement.online/health)，返回 {"status":"ready"} |
| 网页托管 | 腾讯云 EdgeOne Makers，全球可用区（不含中国大陆） |
| AI 服务器 | 腾讯云轻量应用服务器，新加坡一区，Ubuntu 24.04.4 LTS |
| 图库、照片和作品 | 保存在用户电脑的原片目录及本地图库目录；服务器不是图库备份 |
| 使用入口 | 以桌面新版 Chrome / Edge 的正式 HTTPS 地址为本轮操作基线 |
| 对外发布阶段 | 基础上线准备完成，适合先邀请少量用户试用 |

## 2. 本次对话的目标和最终决策

用户最初希望把光影集放在固定网址，打开即可使用，普通照片和图库留在本地，降低后端存储和吞吐量，同时尽量接近 Windows 版体验。用户没有部署经验，因此本轮采用逐步指导、实际操作反馈及只读复核相结合的方式推进。

最终确定并执行的路线是：

1. 网页程序由 **EdgeOne Makers 境外静态分发**提供。
2. 普通图库功能在浏览器内运行，使用用户授权的本地目录。
3. AI 功能通过 **新加坡独立中转**连接已有千问接口，凭据由用户在页面会话中输入，逐次确认发送。
4. 域名继续放在 **阿里云注册和解析**，没有转移注册商或切换到 Cloudflare DNS。

对话中曾讨论大陆托管、备案准备及 Vercel/Cloudflare 方案；实际部署采用上述 EdgeOne＋新加坡路线。用户没有为本轮路线购买大陆服务器。当前域名未办理网站 ICP 备案，EdgeOne 实际区域是“全球可用区（不含中国大陆）”。

对话最初的材料基线为 2.5.1，但实际生成、上传并验收的是 **2.6.1** 发布包。旧 2026-10-14 预览包不作为当前上线包。

## 3. 数据在哪里，以及 AI 的例外

~~~mermaid
flowchart LR
    EO["EdgeOne Makers<br/>静态网页、字体和运行时"] -->|"加载程序"| B["用户桌面浏览器"]
    O["用户原片目录"] -->|"用户授权，只读访问"| B
    B <-->|"保存记录、预览、草稿和作品"| L["用户本地图库目录"]
    B <-->|"逐次确认后，通过 WSS<br/>传输处理图片及会话密钥"| R["新加坡 Caddy + AI Relay"]
    R <-->|"HTTPS，固定千问接口"| Q["maas.qianwenaiapi.com"]
~~~

### 3.1 普通图库功能

- 网页程序下载到浏览器，图库记录及派生内容保存到用户选择的数据目录。
- 本地图库以 library.json 为入口，并包含 photos、drafts、works、exports 等实际存在的子目录。
- 从目录关联的原片保持只读；文件选择导入的副本可以随图库保存和备份。两种来源不能混同。
- 目录授权句柄及站点偏好由本地浏览器管理。换浏览器、浏览器配置或网站地址，需要重新授权。
- 日常使用固定的正式 HTTPS 地址。站点数据清除后，可重新打开保留在磁盘上的图库并授权原片；清除站点数据后的真实环境演练尚未完成。
- 原片和图库目录是不同的备份对象。程序不会把关联原片自动全部纳入图库备份。

实际个人图库和原片目录的完整路径未被本轮工具读取。用户可在网页“设置 → 本地图库”查看数据目录。

### 3.2 AI 请求

“照片和数据留在本地”适用于普通图库操作。**AI 是用户主动确认后的联网例外**：

- 用户在“AI 服务设置”输入自己的千问密钥。
- 密钥保存在当前页面会话内存，关闭页面后清除，不写入图库或浏览器持久存储。
- 中转地址可以作为站点偏好保存；保存地址不等于保存密钥。
- 网页逐次显示发送及可能计费的确认提示；确认后才发送处理图片和本次凭据。
- 图片处理会移除 EXIF/GPS；AI 使用的是处理后的图片，原片不被覆盖。
- 本项目中转不设置照片数据库，不把请求图片、返回作品或用户密钥持久化到磁盘。
- 上游接口自己的数据保留政策未被本轮审计，不能把“本项目中转不落盘”扩展为对第三方服务的承诺。
- 真实生成由用户自己在网页确认；本轮工具没有代读模型密钥、主动执行收费生成或自动重试。

当前固定上游接口为：

~~~text
https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation
~~~

这是项目已配置并在 Windows 版使用的千问接口。本轮没有认证该域名属于阿里云官方；继续使用这个接口对应的独立凭据。模型权限和账单由相应接口账户决定，不能替换为 OpenAI 凭据。

## 4. 网站、域名和 HTTPS

### 4.1 EdgeOne 项目

| 字段 | 实际值 |
| --- | --- |
| 项目名称 | photomanagement |
| 项目 ID | makers-o7xx3x5jqy77 |
| 项目域名管理 | [EdgeOne 控制台](https://console.cloud.tencent.com/edgeone/makers/project/makers-o7xx3x5jqy77/domain) |
| 部署方式 | 直接上传 browser-static.zip |
| 加速区域 | 全球可用区（不含中国大陆），由用户在创建时确认 |
| 正式域名 | photomanagement.online |
| 平台分配地址 | photomanagement-pv2hks9v.edgeone.dev；本轮不作为长期使用入口 |
| HTTPS | 已申请免费边缘证书，采用自动验证，用户确认生效 |
| 强制 HTTPS | 已开启，选用 301 |

本轮只验收了正式根域名和 AI 子域名，www 地址不作为已验证入口。HSTS 和 OCSP 没有在本轮额外启用。

### 4.2 DNS

域名在阿里云购买并完成实名认证。权威 DNS 当前为 dns19.hichina.com 和 dns20.hichina.com。

| 记录类型 | 主机记录 | 记录值 / 用途 |
| --- | --- | --- |
| CNAME | @ | photomanagement.online.pages.dnsoe4.com，指向 EdgeOne 网页 |
| A | ai | 43.156.228.160，指向新加坡中转 |
| TXT | edgeonereclaim | 已完成 EdgeOne 归属权验证；保留已有有效记录，具体值查控制台或现有 DNS |

2026-10-17 的只读复核再次确认了上述 NS、根域名 CNAME 和 AI 的 A 记录。

### 4.3 实际响应与资源

- 正式网页通过有效证书校验，返回 200；首页 SHA-256 与发布包一致。
- HTTP 请求返回 301，跳转到对应 HTTPS 地址。
- CSP、COOP same-origin 和 COEP require-corp 已生效。
- 首页和 Service Worker 采用更新检查所需的缓存规则，主要带哈希的脚本/WASM 已核对长期缓存。
- 前序公网检查曾完整下载静态包内 66 个文件，66/66 的 SHA-256 与发布包匹配，包含字体、RAW 运行时和许可证。
- 2026-10-17 从新加坡实例直接请求首页、index-BxqvMote.js、charts-IW1uTR6z.js，均返回 200 且文件哈希匹配。这是境外服务器侧的可达性证据，不是全球浏览器体验保证。
- manifest.webmanifest 内容返回正常，但本次复核仍是 application/octet-stream。普通网页已可用，PWA 安装体验尚未验收。

## 5. 服务器现状

### 5.1 资源与购买情况

| 字段 | 已核对情况 |
| --- | --- |
| 云平台 / 产品 | 腾讯云轻量应用服务器 Lighthouse，入门型 |
| 地域 | 新加坡一区 |
| 实例名称 | Ubuntu-c7ly |
| 公网 IPv4 | 43.156.228.160 |
| 系统 | Ubuntu 24.04.4 LTS，amd64 |
| CPU / 内存 | 2 核 / 2GB |
| 系统盘 | 40GB SSD |
| 带宽 / 月流量包 | 峰值 20Mbps / 512GB |
| 购买周期 | 1 台、1 个月 |
| 购买前页面价格 | 合计 30 元；后续续费按实际订单价格核对 |
| 到期时间 | **2026-11-16 23:38:59**，按用户控制台截图记录 |
| 自动续费 | **关闭**，没有代为开启 |
| 本轮服务用途 | 仅用于 AI 中转及其 HTTPS 代理 |

### 5.2 登录与部署位置

- 已通过专用 SSH 密钥成功以 ubuntu 用户登录，可使用免交互 sudo。
- 腾讯云中的密钥名称为 **photocollection_sg**，名称使用下划线。
- 本机专用私钥位置：C:/Users/wonder/.ssh/photocollection-sg-20261016_ed25519。
- 公钥位于同名 .pub 文件，专用 known_hosts 位于 C:/Users/wonder/.ssh/known_hosts_photocollection_sg。
- 私钥 ACL 已限制为当前用户及 SYSTEM；密钥文件不在仓库或发布包里。换电脑时由所有者保管、迁移或重新绑定密钥。
- 实际部署目录：/opt/photocollection-relay/2.6.1-20261016T122152Z。
- 上传的源包：/opt/photocollection-relay/relay-server-20261016T122152Z.zip，传输后 SHA-256 已核对。

### 5.3 运行组件

| 项目 | 当前配置 / 交接复核 |
| --- | --- |
| Docker | 29.9.1，按官方 Ubuntu 软件源安装，已配置开机启动 |
| Docker Compose | 5.6.0 |
| Caddy | 本次部署版本 2.11.7，使用 caddy:2 镜像标签 |
| Compose 项目名 | photocollection-relay |
| 中转容器 | photocollection-relay-relay-1，running / healthy，重启计数 0 |
| 代理容器 | photocollection-relay-https-1，running，重启计数 0 |
| 代理健康状态说明 | 未另设独立容器 healthcheck；以运行状态和公网 HTTPS 检查核对 |
| 容器重启策略 | 两个服务均为 unless-stopped |
| 中转镜像 | Python 3.12-slim 基础镜像，使用现有 FastAPI/Uvicorn 中转程序 |

已配置自启策略，尚未执行整台服务器重启演练。基础镜像及 caddy:2 是可变标签，后续计划重建时应核对实际版本，不把今天的版本表视为永久锁定。

### 5.4 网络、数据与日志

- 云防火墙已有 22、80 和 ICMP，用户按指导补充 TCP 443。
- Caddy 只把 TCP 80/443 映射到宿主机，中转通过容器内部网络提供 9000。
- 9000 未映射到宿主，Caddy 管理端口 2019 也未映射。
- 中转运行 UID/GID 为 65534:65534，根文件系统只读，移除全部 capabilities，禁止提权。
- 中转临时目录为 32MiB tmpfs，没有持久化数据卷，关闭核心转储和容器日志。
- Caddy 没有启用访问日志；Docker 运行日志限制为最多 2 个、每个 5MB。
- Caddy 的持久卷只用于证书与配置：photocollection-relay_certificates 和 photocollection-relay_caddy_config。
- 原有 Windows / 本地开发服务继续按仓库要求使用回环监听。公网开放的是本轮明确部署的独立云中转。

## 6. AI 中转的配置与边界

| 参数 / 行为 | 当前值 |
| --- | --- |
| 前端构建参数 | VITE_ART_RELAY_URL=wss://ai.photomanagement.online/cloud-art |
| 服务器允许来源 | PHOTO_RELAY_ORIGIN=https://photomanagement.online |
| 对外路由 | /health 与 /cloud-art；其他路径返回 404 |
| WebSocket 来源校验 | 精确匹配 Origin，拒绝带查询参数的连接 |
| 并发 | 每进程 2 个；当前为单个中转服务实例 |
| 图片限制 | 最多 8MiB，PNG/JPEG/WebP，最长边不超过 1536px |
| 上传数据块 | 64KiB；Uvicorn WebSocket 帧上限设置为 131072 字节 |
| 提交保护 | 收齐图片后仍需显式 submit 帧，才会进入实际生成流程 |
| 应用总时限 | 880 秒 |
| 上游 / 下载时限 | 上游请求 600 秒；结果图片下载 60 秒 |
| 保活 | 生成等待期间每 20 秒发送等待帧 |
| Caddy 流时限 | 15 分钟 |
| 重试策略 | 不自动重试可能计费的生成 |

边界说明：

- /health 的 ready 表示中转已配置允许来源，不代表用户密钥、模型权限或账单均正常。
- Origin 校验属于请求来源约束，不是账户认证；非浏览器客户端能够伪造 Origin。当前没有用户账户体系或按用户计费配额。
- 2 并发限制及图片大小限制不是费用封顶机制，告警也不是自动断流开关。
- 本轮通过了公网握手、错误来源拒绝、超限元数据拒绝、合成图片二进制上传及取消提交保护检查，没有在这轮合成检查中请求真实生成。
- 用户另行在网页主动确认的真实水彩生成成功；实际模型账单次数和金额未被本轮工具读取。
- 880 秒应用时限小于 900 秒，不能写成“有效业务请求已验证持续至少 900 秒”。接近上限的长任务仍待验收。

## 7. 费用、续费和提醒

| 项目 | 当前情况 | 后续关注 |
| --- | --- | --- |
| EdgeOne 静态托管 | 本轮沿所选托管方案完成上线 | 以平台实时配额和计费页为准，不承诺永久免费或无限量 |
| 新加坡服务器 | 购买前页面为 30 元/月、512GB 月流量包 | 续费价格、套餐周期及超额出流量计费以控制台为准 |
| 千问生成 | 用户使用自己的接口凭据 | 与腾讯云服务器账单分开；核对各自模型权限、额度和账单 |
| 腾讯云余额预警 | 用户按建议阈值 30 元设置并反馈完成 | 这是通知阈值，不是充值、自动续费或消费额度 |
| 流量告警 | 剩余量 ≤20%，1 分钟统计、连续 1 个数据点、每 1 小时提醒 | 用户已反馈保存并启用；实际消息投递尚未通过触发验收 |
| 监控通知模板 | 系统预设模板，截图显示 1 个接收人 | 用户按指引核对本人及可用通知渠道 |
| 财务通知 | 账户预警、账户欠费、产品到期/回收通知 | 用户已按指引核对保存；欠费和到期/回收保留系统要求的站内信、短信 |
| 服务器到期 | 2026-11-16 23:38:59，自动续费关闭 | 所有者在到期前根据实际使用决定续费 |
| 域名到期 | 注册局 RDAP 公布日期为 2027-10-16 | 阿里云续费单价、自动续费及提醒配置尚未读取 |

域名的注册局到期事件为 2027-10-16T08:58:20.935Z，即北京时间 2027-10-16 16:58:20。实际续费操作及价格以阿里云控制台为准。[注册局 RDAP 记录](https://rdap.radix.host/rdap/domain/photomanagement.online)

服务器月流量包统计出流量，重置周期按腾讯云实际套餐周期核对，不直接假设为每月 1 日。到期通知设置不代表已经执行续费。

## 8. 已完成验收及证据强度

### 8.1 用户实际操作反馈

| 操作 | 反馈结果 |
| --- | --- |
| 从正式网址打开网页 | 看见“新建本地图库”和“打开本地图库或备份” |
| 新建图库 | 成功进入主界面 |
| 导入少量 JPEG 并查看 | 成功 |
| 关闭网页后重开图库及照片 | 仍能看到并打开 |
| 保存网页会话密钥和中转设置 | 页面提示 API Key 和中转地址已配置 |
| 主动确认单张水彩生成 | 反馈“已生成” |
| 下载作品、打开文件、重开后再次查看和下载 | 反馈“全部正常” |
| 独立目录备份，在启动页打开备份副本 | 照片和水彩作品恢复正常 |
| 余额、流量及财务通知设置 | 按逐项指引核对后反馈完成 |

这些是用户的操作验收反馈。没有据此扩大为全部格式、全部浏览器、全部地区、全部模型质量或所有账单均已通过。

### 8.2 前序自动检查记录

本次文档整理没有重新运行全套应用测试；以下沿用生成当前发布包时已记录的结果：

| 检查 | 已记录结果 |
| --- | --- |
| npm test | 78 项通过 |
| npm run test:frontend | 11 项通过 |
| npm run test:relay | 6 项通过，模拟上游 |
| .venv/Scripts/python.exe -m unittest desktop.test_icon | 1 项通过 |
| npm run build 与 npm run build:web | 通过 |
| npm run test:web | 32 项通过，含合成原片哈希、本地恢复及模拟 AI |
| npm run test:web:cloud | 通过，使用模拟中转 |
| npm run test:browser | 完整运行 35 项通过，另 1 项发现测试上传等待竞态；补充等待后仅复跑失败项，1 项通过 |
| 发布包白名单与自检 | 通过，合成图库、环境变量、数据库和照片不能混入代码目录 |
| ZIP 完整性 | 两个包的数量、CRC 和 SHA-256 通过，本次交接再次核对 |
| 服务器部署 | Compose / Caddy 配置校验、镜像构建、启动和健康检查通过 |

桌面浏览器回归使用项目 Python：

~~~powershell
$env:PHOTO_TEST_PYTHON = 'C:/Users/wonder/Documents/ChatGPT/photo_collection/.venv/Scripts/python.exe'
npm run test:browser
~~~

系统默认 Python 缺少 uvicorn，因此曾造成首次回归启动失败。另一个测试修复是在 frontend/tests/art.spec.mjs 等待上传控件就绪，未因此修改应用行为。**未在该修复后完整重跑全部 36 项**，不要合并表述为“修复后全套 36 项重新通过”。

## 9. 发布产物与代码现场

### 9.1 当前上线包

本地目录：C:/Users/wonder/Documents/ChatGPT/photo_collection/releases/PhotoCollection-Web-2.6.1-20261016T122152Z。

| 文件 | 实际用途 | 本次核对 |
| --- | --- | --- |
| [browser-static.zip](/C:/Users/wonder/Documents/ChatGPT/photo_collection/releases/PhotoCollection-Web-2.6.1-20261016T122152Z/browser-static.zip) | EdgeOne 直接上传；ZIP 根目录有 index.html | 66 个文件，14,458,918 字节，CRC 通过 |
| [relay-server.zip](/C:/Users/wonder/Documents/ChatGPT/photo_collection/releases/PhotoCollection-Web-2.6.1-20261016T122152Z/relay-server.zip) | 新加坡中转源码、Docker、Compose、Caddy 配置 | 10 个文件，10,461 字节，CRC 通过 |
| [release-manifest.json](/C:/Users/wonder/Documents/ChatGPT/photo_collection/releases/PhotoCollection-Web-2.6.1-20261016T122152Z/release-manifest.json) | 构建版本、时间、域名及文件清单 | 构建时记录 |
| [SHA256SUMS.txt](/C:/Users/wonder/Documents/ChatGPT/photo_collection/releases/PhotoCollection-Web-2.6.1-20261016T122152Z/SHA256SUMS.txt) | 传输与交付校验 | 与本次计算一致 |

~~~text
browser-static.zip
372fe1ccdd9a10915f5665ea349b6baecdd52179bab506cf00061f04c5f21e8d

relay-server.zip
2c5f43c91e7b0c6b832b12bc6250395766e06faba3c615734b4cb5561f4b7384
~~~

release-manifest.json 中 publicly_deployed=false 是打包时未上传的历史状态；实际部署已完成，以本交接文档、执行记录、控制台及公网检查为准。本轮没有为修改该标志而重写当前发布包。

静态包已包含相应字体、RAW 运行时及许可证。包内无用户密钥或个人图库；releases 目录不纳入 Git。

### 9.2 工作区状态

工作区为 C:/Users/wonder/Documents/ChatGPT/photo_collection。交接时只读检查得到：

| 项目 | 值 |
| --- | --- |
| 当前分支 | codex/windows-batch-watercolor |
| HEAD | 879c101 |
| 本机缓存 origin/main | 10601ca |
| HEAD 相对缓存 main | 领先 0、落后 4 个提交 |
| 工作区状态 | 生成本文前有 68 条状态记录，包含既有修改与未跟踪文件；不是干净工作区，新增本文后数量会变化 |
| 根项目 / 前端版本 | 均为 2.6.1 |
| 正式代码发布状态 | 当前包来自工作区；本轮未推送代码、未创建 PR 或 GitHub 正式发行 |

本次交接整理没有执行 fetch、切分支或合并。以上 origin/main 是本机缓存，不宣称是远端此刻最新状态。接手集成前重新 fetch、核对差异，并保留已有工作区修改。

### 9.3 主要入口

| 文件 | 职责 |
| --- | --- |
| [storage.ts](/C:/Users/wonder/Documents/ChatGPT/photo_collection/frontend/src/browser/storage.ts) | 本地图库、授权句柄、备份与恢复 |
| [cloud.ts](/C:/Users/wonder/Documents/ChatGPT/photo_collection/frontend/src/browser/cloud.ts) | 会话密钥、云端确认、WSS 传输 |
| [api.ts](/C:/Users/wonder/Documents/ChatGPT/photo_collection/frontend/src/browser/api.ts) | 浏览器本地 API 适配 |
| [app.py](/C:/Users/wonder/Documents/ChatGPT/photo_collection/cloud_relay/app.py) | 独立 AI 中转、协议校验与上游请求 |
| [compose.yaml](/C:/Users/wonder/Documents/ChatGPT/photo_collection/cloud_relay/compose.yaml) | 两个容器及限制、端口、持久卷 |
| [Caddyfile](/C:/Users/wonder/Documents/ChatGPT/photo_collection/cloud_relay/Caddyfile) | ai 域名 HTTPS、路由及 WebSocket 代理 |
| [package-browser-release.py](/C:/Users/wonder/Documents/ChatGPT/photo_collection/frontend/scripts/package-browser-release.py) | 发布白名单、静态 ZIP、中转 ZIP、清单与校验码 |
| [smoke-relay.py](/C:/Users/wonder/Documents/ChatGPT/photo_collection/.test-artifacts/relay-deploy/smoke-relay.py) | 公网非计费边界检查，使用合成数据、不发送生成提交帧 |

.test-artifacts 下的部署辅助脚本和检查脚本是本机忽略文件，不保证新克隆的仓库中存在。其中 bootstrap-docker.sh 与 start-relay.sh 是本轮首次部署辅助文件，不能当作任何新环境都可直接重复执行的通用安装器。

## 10. 接手后的常用操作

### 10.1 本机连接服务器

以下命令使用所有者电脑上已经存在的专用密钥和 known_hosts。新电脑应先由所有者处理密钥迁移或重新绑定。

~~~powershell
ssh -i "$env:USERPROFILE/.ssh/photocollection-sg-20261016_ed25519" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$env:USERPROFILE/.ssh/known_hosts_photocollection_sg" ubuntu@43.156.228.160
~~~

### 10.2 只读检查

登录服务器后：

~~~sh
cd /opt/photocollection-relay/2.6.1-20261016T122152Z
sudo docker compose -p photocollection-relay -f cloud_relay/compose.yaml ps
curl --fail --silent --show-error https://ai.photomanagement.online/health
sudo docker compose -p photocollection-relay -f cloud_relay/compose.yaml config --quiet
~~~

在本机工作区根目录执行非计费公网协议检查：

~~~powershell
.venv/Scripts/python.exe .test-artifacts/relay-deploy/smoke-relay.py
~~~

该脚本不会发送真实生成所需的 submit 帧；不应把脚本改成自动读取用户密钥或测试真实照片。

### 10.3 计划更新

- 前端更新：保留上一份可用 ZIP，确认版本及必要回归，使用正式中转地址构建并打包，再在当前 EdgeOne 项目直接上传。完成后核对首页、资源、缓存和本地图库重开。
- 中转更新：保留原始源包和当前配置，先核对部署差异与相关测试，在维护窗口进行；有进行中的 AI 任务时避免重启引发计费状态不明。
- DNS、80/443 及证书持久卷是现有服务的依赖。更新容器时保留证书卷，不使用删除卷的操作替代正常更新。
- 出现生成断连或超时，先确认错误和用户账单状态，不自动重发收费请求。

确需发布新版前端时，在本机工作区根目录使用现有构建及打包脚本：

~~~powershell
$env:VITE_ART_RELAY_URL = 'wss://ai.photomanagement.online/cloud-art'
npm run build:web
.venv/Scripts/python.exe frontend/scripts/package-browser-release.py --self-test
.venv/Scripts/python.exe frontend/scripts/package-browser-release.py
~~~

上述命令是后续发布参考；当前仅交接文档，无需重建或重新上传已经验证的包。

本轮文档整理没有更新程序、重启容器、修改 DNS、开启自动续费或执行收费模型调用。

## 11. 尚未完成的事项与优先级

| 优先级 | 待办 | 验收方式 / 当前限制 |
| --- | --- | --- |
| 高 | 国内不同运营商与海外真实终端试用 | 记录地区、网络、浏览器、时间，检查首次加载、授权、照片浏览和重开；新加坡服务器 HTTP 成功不能代替终端体验 |
| 高 | 核对阿里云域名续费单价、自动续费和提醒 | 公开 RDAP 只给注册局到期时间，不提供阿里云账户内的配置 |
| 高 | 核对实际通知接收及模型账单 | 配置完成不等于已经验证消息投递；真实水彩成功不等于费用明细已核对 |
| 中 | 清除站点数据后重新授权恢复 | 在独立测试环境、已备份的测试图库上演练；目前手工通过的是重开及备份副本恢复 |
| 中 | 全格式导出、编辑、水印、标题功能 | 手工本轮主要围绕少量 JPEG 与水彩 PNG 路径；不沿用为所有功能均已通过 |
| 中 | 大图库性能、并发、长任务和取消/断连 | 按 880 秒应用时限验收；不自动产生收费请求 |
| 中 | PWA 安装、离线和更新体验 | manifest MIME 仍为 application/octet-stream，安装尚未验收 |
| 中 | 更新及回退演练 | 保留已有可用包，验证静态缓存更新、本地目录授权及作品不丢失 |
| 中 | 代码集成和正式发行整理 | 工作区有既有修改，先审查远端及工作树，再按仓库规则推进 |

后续默认从现有 EdgeOne 项目、新加坡实例和本地数据模型继续维护。改变区域、引入服务器图库存储、改用新上游接口、恢复退役平台或改变原片处理规则，均应作为新需求评估。

## 12. 仓库规则及继续工作的顺序

1. 阅读 [AGENTS.md](/C:/Users/wonder/Documents/ChatGPT/photo_collection/AGENTS.md)、[CONTRIBUTING.md](/C:/Users/wonder/Documents/ChatGPT/photo_collection/CONTRIBUTING.md) 及 [开发交接基线](/C:/Users/wonder/Documents/ChatGPT/photo_collection/docs/development-handoff-2026-10-13.md)，再结合本文和实际工作区核对。
2. 原片保持只读，删除记录、人物、草稿和作品不能删除或覆盖原片；自动测试使用 .test-artifacts 下的合成数据。
3. 私人数据库、模型权重、密钥、日志、截图和 .local-notes 不进入 Git 或发布包，保留字体许可证和素材来源。
4. 使用 codex/ 分支，集成前检查远端；保留其他工作区和现有修改，不强制推送或重置其他工作。
5. 文档维护不改变应用行为。涉及 schema、存储迁移、图片渲染和导出时运行相关回归，必要时核对原片哈希。
6. Windows 桌面和本地 web 服务继续使用回环监听。Android、iOS、配对、远程访问及 Express 原型已退役。
7. 真实 AI 请求需要用户逐次确认；密钥与上游分开核对，不自动上传真实照片、自动计费生成或自动重试。

相关记录与官方依据：

- [实际执行记录](/C:/Users/wonder/Documents/ChatGPT/photo_collection/docs/browser-deployment-status-2026-10-16.md)：逐项证据、包校验值、实际部署位置。
- [上线清单](/C:/Users/wonder/Documents/ChatGPT/photo_collection/docs/browser-launch-checklist.md)：已完成与未完成项。
- [新手操作指南](/C:/Users/wonder/Documents/ChatGPT/photo_collection/docs/browser-launch-beginner-guide.md)：控制台与用户操作参考。
- [部署方案](/C:/Users/wonder/Documents/ChatGPT/photo_collection/docs/browser-global-deployment-plan-2026-10-16.md)：路线及价格依据。
- [EdgeOne 域名管理](https://cloud.tencent.com/document/product/1552/127404)、[Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)、[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)。
- [腾讯云余额预警](https://cloud.tencent.com/document/product/555/9942/)、[轻量服务器流量告警](https://cloud.tencent.com/document/product/1207/44569/)、[财务消息订阅规则](https://cloud.tencent.com/document/product/1263/46205)。

本文交接的是当前已上线的基础服务及其验证边界。后续工作优先围绕小范围真实网络试用、维护期限、数据恢复和可控更新推进。
