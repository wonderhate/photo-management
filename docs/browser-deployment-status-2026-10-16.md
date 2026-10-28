# 光影集境外上线：实际执行记录

更新日期：2026-10-17。采用用户确认的“EdgeOne 境外静态分发＋新加坡 AI 中转”。

网站现状、服务器、数据边界、凭据保管、维护命令和后续事项的综合交接，见 [网页版上线交接文档](/C:/Users/wonder/Documents/ChatGPT/photo_collection/docs/browser-deployment-handoff-2026-10-17.md)。

## 当前到哪一步

- 已完成当前 2.6.1 浏览器构建，默认中转地址为 `wss://ai.photomanagement.online/cloud-art`。
- 用户已确认 EdgeOne 区域为“全球可用区（不含中国大陆）”。
- 域名归属权 TXT 已确认生效，正式域名的 CNAME 已配置为 `photomanagement.online.pages.dnsoe4.com`；阿里云两台权威 DNS 均已核对。
- [正式网址](https://photomanagement.online/) 已通过有效证书的 HTTPS 校验，首页返回 200，标题为“光影集 · 摄影照片管理”。CSP、COOP 和 COEP 响应头已生效。
- 用户已开启强制 HTTPS。无缓存探测确认 HTTP 返回 301 并指向同一路径的 HTTPS；最初曾读取到 302，随后复查已取得 301。
- 从公网下载并核对上传包内全部 66 个文件，66/66 的 SHA-256 均匹配，包含网页代码、字体、RAW 运行时和许可证。脚本及 WASM 类型、主要缓存规则已检查。
- 用户已在自己的电脑看到图库入口，成功新建独立本地图库、导入测试照片并打开查看；关闭网页后重开，仍能看到并打开照片。此项是用户对首轮实际操作的反馈，不代表全部浏览器、导出和恢复场景均已验收。
- 用户已完成导入、作品下载、重开及备份副本恢复；国内各运营商和海外真实终端的访问质量仍需小范围试用。单个网络和服务器请求不能代替全部地区的浏览器体验验收。
- 用户已创建新加坡一区的 Ubuntu 实例，公网 IPv4 为 `43.156.228.160`；专用公钥已由用户以 `photocollection_sg` 名称导入并绑定，已成功使用默认 `ubuntu` 用户登录，核实为 Ubuntu 24.04.4 LTS / amd64。
- `ai` 的 A 记录经本机默认 DNS、1.1.1.1 和 8.8.8.8 查询均为 `43.156.228.160`。用户防火墙截图已有 TCP 80，随后按指导补充 TCP 443；公网 HTTPS 和 WSS 检查均通过。
- 已按 Docker 官方 Ubuntu 软件源安装 Docker 29.9.1、Compose 5.6.0。中转包传输后 SHA-256 匹配；Compose 与 Caddy 配置校验、镜像构建、容器启动通过，中转健康状态为 healthy。Caddy 实际版本为 2.11.7。
- [中转健康检查](https://ai.photomanagement.online/health) 以有效 TLS 证书返回 `{"status":"ready"}`；HTTP 跳转到 HTTPS。公网 WSS 对错误 Origin 和携带查询参数的握手返回 403；无效或超限元数据被拒绝，响应未回显合成密钥。合成 PNG 的二进制传输及取消提交检查通过，没有向模型提交任何请求。
- 已核实运行容器：中转为 UID/GID 65534、根文件系统只读、临时目录 tmpfs、移除全部 capabilities、禁止提权、禁用容器日志、没有持久挂载；9000 没有映射到宿主。Caddy 仅映射 TCP 80/443，证书及代理配置保存在独立卷，运行日志上限为 2 × 5MB，未启用访问日志。
- 从新加坡对当前千问接口发出不带凭据或图片的 HEAD 请求，TLS 校验通过，返回 401；这一探测只证明 DNS/TLS/网络连通。随后用户在正式网页保存本次会话的千问密钥及中转配置，并主动确认单张测试水彩生成，反馈“已生成”；生成后再次探测中转健康状态仍为 ready。此项依据用户实际操作反馈，质量对照、计费明细和完整备份恢复仍待验收。
- 专用私钥仅在用户主目录 `.ssh` 下，ACL 仅保留当前用户和 SYSTEM；不在仓库或发布包中。未读取用户千问密钥；真实生成由用户在网页主动确认，代理没有自行调用收费模型或自动重试。
- 用户已按步骤下载生成作品、关闭网页、重开同一本地图库并再次查看和下载作品，反馈“全部正常”。真实图片质量的独立评估和 PNG/JPG 全格式对照未据此宣称完成。
- 用户随后完成独立目录备份，并在启动页打开自动生成的备份图库检查照片和水彩作品，反馈“正常”。这是备份副本打开恢复的验收，尚未进行清除站点数据后的重新授权演练。
- 用户流量告警第二步截图显示：网络流量包剩余量百分比 ≤20%、统计粒度 1 分钟、连续 1 次满足条件、每 1 小时告警一次，已选系统预设通知模板（1 个接收人）。用户按查看核对本人及可用通知渠道、完成保存和确认启用的指引反馈“好了”；未进行真实阈值触发或测试通知的投递验收。
- 实例卡片截图确认实际套餐为 2 核、2GB、40GB 系统盘、512GB/月流量及 20Mbps 峰值带宽；到期时间显示 `2026-11-16 23:38:59`，自动续费开关关闭。到期时间按控制台显示记录，不推算或代为启用续费。
- 用户按“费用中心”消息订阅指引核对账户预警、账户欠费、产品到期/回收通知及本人接收渠道后反馈“可以了”。此项是用户确认保存，尚未通过实际余额不足、到期或测试消息验收投递。
- 2026-10-17 从新加坡实例直接请求正式网页、入口 `index-BxqvMote.js` 和预载 `charts-IW1uTR6z.js`，均以有效 TLS 返回 200，三个文件的 SHA-256 均与发布包匹配；中转 `/health` 返回 ready。请求耗时分别约 0.382、0.277、0.374、1.118 秒，仅是这次服务器请求的结果，不是浏览器首屏或全球性能承诺。
- 通过 IANA RDAP 引导定位到 [注册局记录](https://rdap.radix.host/rdap/domain/photomanagement.online)，公开域名到期事件为 `2027-10-16T08:58:20.935Z`（北京时间 2027-10-16 16:58:20）。实际续费操作日期及价格以阿里云控制台为准；未读取或修改域名自动续费设置。

**基础上线准备已完成，可以进入小范围试用。** 网页、新加坡中转、首次真实水彩、下载、重开、备份恢复及账户提醒设置均已完成相应检查或用户反馈；新加坡侧网页和入口资源检查通过。国内多运营商、海外真实终端、长任务和大图库等仍保留在后续验收清单中。现有网页包已内置正确中转地址，不需要重新上传。

## 本机已生成的交付文件

下面是忽略在 Git 之外的本机构建产物；网页包的文件直接位于 ZIP 根目录。

| 文件 | 用途 | 大小 |
| --- | --- | --- |
| [browser-static.zip](../releases/PhotoCollection-Web-2.6.1-20261016T122152Z/browser-static.zip) | EdgeOne 直接上传，66 个文件 | 14,458,918 字节，约 13.8 MiB |
| [relay-server.zip](../releases/PhotoCollection-Web-2.6.1-20261016T122152Z/relay-server.zip) | 新加坡服务器的中转源码与 Compose/Caddy 配置，10 个文件 | 10,461 字节 |
| [release-manifest.json](../releases/PhotoCollection-Web-2.6.1-20261016T122152Z/release-manifest.json) | 构建版本、时间、域名、包大小和校验值 | 构建时状态记录 |
| [SHA256SUMS.txt](../releases/PhotoCollection-Web-2.6.1-20261016T122152Z/SHA256SUMS.txt) | 上传或传输后的完整性核对 | SHA-256 |

网页包 SHA-256：`372fe1ccdd9a10915f5665ea349b6baecdd52179bab506cf00061f04c5f21e8d`。

中转包 SHA-256：`2c5f43c91e7b0c6b832b12bc6250395766e06faba3c615734b4cb5561f4b7384`。

构建清单里的 `publicly_deployed: false` 记录打包时尚未上传的状态；后续上线进度以本页及实际控制台、公网验收为准。此次构建来自当前工作区，未推送代码或建立 GitHub 正式发行。

## 已完成的本地检查

| 检查 | 实际结果 |
| --- | --- |
| 后端单元检查 `npm test` | 78 项通过 |
| 前端逻辑 `npm run test:frontend` | 11 项通过 |
| 中转模拟 `npm run test:relay` | 6 项通过，不调用真实模型 |
| 桌面图标 | 1 项通过 |
| 桌面和浏览器生产构建 | 均通过 |
| 浏览器本地版 `npm run test:web` | 32 项通过，包含原片哈希、本地恢复和模拟 AI |
| 云端确认流程 `npm run test:web:cloud` | 通过，使用模拟中转 |
| 桌面浏览器回归 | 完整运行中 35 项通过；另 1 项暴露上传未完成就点击的测试竞态，补充等待上传完成后，单独复跑该项通过 |
| 发布包白名单检查 | 拒绝合成的图库、环境变量、数据库和照片混入生成代码目录 |
| ZIP 与清单检查 | 两个包的 CRC、数量、禁止路径和 SHA-256 均通过 |

桌面浏览器检查需设置 `PHOTO_TEST_PYTHON` 为项目 `.venv/Scripts/python.exe`，系统默认 Python 缺少 uvicorn。未为此修改用户系统 Python。测试修复只增加等待两张上传照片就绪，不修改应用行为。

本地没有 Docker；已在新加坡服务器完成镜像构建、Compose 启动、Caddy 配置加载和公网 WSS 非计费检查。首次真实水彩生成已由用户确认成功；接近超时上限的长任务、质量对照及计费明细仍未验收。应用总时限为 880 秒，Caddy 流时限为 15 分钟，不能把业务连接持续 900 秒写成当前实现已通过的检查。

## 当前步骤与后续验收

1. 已完成：用户在电脑看到图库入口，新建空目录图库，导入并查看测试照片，关闭后重开仍可用。
2. 已完成：新加坡服务器创建成功。购买前页面选择 Linux 入门型、2 核 2GB、40GB SSD、20Mbps、0.5TB/月、1 台 1 个月，页面合计 30 元；创建截图确认新加坡一区及运行状态。
3. 已完成：`ai` DNS、密钥绑定、系统核实、Docker、80/443、独立中转和有效证书 HTTPS/WSS。专用公钥通过 [腾讯云密钥管理流程](https://cloud.tencent.com/document/product/1207/44573) 绑定；安装参考 [Docker 官方 Ubuntu 文档](https://docs.docker.com/engine/install/ubuntu/)。
4. 已完成：网页会话配置、首次单张水彩生成、作品下载和重开、独立目录备份打开恢复。日常继续使用原图库时，可关闭备份图库并在启动页重新打开原来的数据目录。目录关联的原片仍须单独备份。标题、清除站点数据后的重新授权恢复、更新和计费明细继续验收；不自动计费或重试。
5. 邀请国内普通网络和海外目标地区用户分别测试，记录运营商、时间及首次加载表现。
6. 余额预警已由用户反馈完成（指导建议 30 元，未独立读取账户设置）；流量包剩余量 ≤20%、每小时一次的告警，已核对配置摘要并由用户反馈保存完成。到期时间为控制台显示的 `2026-11-16 23:38:59`，自动续费关闭。[财务消息订阅](https://console.cloud.tencent.com/messageCenter/messageConfig) 的账户预警、账户欠费及产品到期/回收通知，已由用户按指引核对接收人及渠道后反馈完成。系统要求及保留的通知渠道依据 [官方消息订阅说明](https://cloud.tencent.com/document/product/1263/46205)，另见 [余额预警流程](https://cloud.tencent.com/document/product/555/9942/) 和 [轻量服务器流量告警流程](https://cloud.tencent.com/document/product/1207/44569/)。实际提醒投递及千问费用明细尚未验收。

已有 TXT 和 CNAME 记录保留。后续项目域名管理和证书流程参考 [官方域名说明](https://cloud.tencent.com/document/product/1552/127404)。

本次公网检查还记录到 `manifest.webmanifest` 内容正确，但平台返回 `application/octet-stream`。本地网页入口已正常响应；安装为应用的兼容性尚未验收，不能据此宣称已通过 PWA 安装检查。

## 后续服务器配置已经准备什么

`cloud_relay/compose.yaml` 复用现有中转容器，通过内部网络交给 Caddy，只映射 80/443，9000 不映射到宿主。中转根文件系统只读，禁用核心转储和容器输出日志。Caddy 不启用访问日志，运行日志限制大小；持久卷用于证书和代理配置，不存图库。

`cloud_relay/Caddyfile` 对 `ai.photomanagement.online` 提供 HTTPS，仅转发 `/health` 和 `/cloud-art`，WebSocket 最长 15 分钟；现有应用自己仍限制 880 秒。代理配置依据 [Caddy 官方反向代理文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)；证书签发需要域名解析和公网 80/443 满足条件。[自动 HTTPS 条件](https://caddyserver.com/docs/automatic-https)

实际部署目录为 `/opt/photocollection-relay/2.6.1-20261016T122152Z`，Compose 项目名为 `photocollection-relay`。已在该目录完成配置校验、构建和启动。后续先进入该目录，再使用以下命令检查或按需启动：

```sh
sudo docker compose -p photocollection-relay -f cloud_relay/compose.yaml config --quiet
sudo docker compose -p photocollection-relay -f cloud_relay/compose.yaml run --rm --no-deps --interactive=false --entrypoint caddy https validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker compose -p photocollection-relay -f cloud_relay/compose.yaml up -d --build --wait --wait-timeout 120
sudo docker compose -p photocollection-relay -f cloud_relay/compose.yaml ps
curl --fail https://ai.photomanagement.online/health
```

上述检查已完成。中转和 Caddy 均配置 `unless-stopped`，Docker 服务已设为开机启动；尚未通过整机重启演练验证。`/health` 返回 ready 只表明来源已配置，不代表模型密钥、模型权限或真实生成已经验证。运行时边界检查脚本位于忽略目录 `.test-artifacts/relay-deploy/smoke-relay.py`，只使用合成图片和合成密钥，不发送模型提交帧。

余额预警、流量告警、监控通知模板和财务消息订阅已由用户反馈核对完成；服务器到期时间和自动续费关闭状态已从截图核对。维护时留意服务器到期、阿里云域名续费价格、平台额度及千问账单；通知不等于消费硬上限。费用与路线依据见 [部署方案](browser-global-deployment-plan-2026-10-16.md)。
