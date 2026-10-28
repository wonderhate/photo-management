# Windows 直链下载维护记录

## 入口与文件

正式下载页：`https://photomanagement.online/windows.html`。默认下载使用 `https://ai.photomanagement.online/downloads/1.0/`，每个包另有 GitHub 备用链接。公开版本名称和文件名为 1.0，软件内容仍为 2.6.1。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| PhotoCollection-Setup-1.0-x64.exe | 265525103 | ba0b0b8a7e35b6f3cb4ee4c4c6949de2fd5ea92d50d21d728780d4d2114de2be |
| PhotoCollection-Windows-1.0.zip | 300796009 | 2c56d6df1ab15c300ba14931776d1f7718833e7c659f6f74192e9455dff8c6be |

EdgeOne Makers 直接上传的静态单文件上限为 25 MB，依据 https://cloud.tencent.com/document/product/1552/127371 。安装包独立存放，不进入 Git、网页构建或 Service Worker 缓存，不采用拆包重组或第三方公共代理。

## 服务器与配置

复用现有新加坡服务器和有效的 `ai.photomanagement.online` HTTPS 证书；不新购资源、不改 DNS。源文件位于 `/opt/photocollection-downloads/1.0/`。正式服务副本位于 Caddy 的持久化命名卷 `photocollection-relay_caddy_config` 中的 `/config/lumina-downloads/1.0/`。宿主机原文件和卷内副本的完整 SHA-256 均核对一致。

`cloud_relay/Caddyfile` 是更新后的代理配置：仅允许列出的三个发布文件（含 SHA256SUMS-1.0.txt）通过 GET / HEAD 下载，不开放目录列表、写入方法、其他文件及父目录。Caddy 提供 Content-Length、Accept-Ranges、206 分段响应和附件下载，浏览器直接保存文件。健康检查、WebSocket 来源校验和 15 分钟代理时限保留。

Ubuntu 自带 `tcp_bbr` 模块。`cloud_relay/tcp-bbr.conf` 安装至 `/etc/modules-load.d/lumina-bbr.conf`；`cloud_relay/compose.yaml` 在 https 服务的网络命名空间配置 BBR，不改变主机默认 TCP 设置。确认没有活动中转连接后，仅重建 https 容器，relay 容器保持运行；未拉取新镜像或调用 AI 生成。重建后确认 sysctl 为 bbr，下载卷和文件摘要仍一致。

运行配置仍位于 `/opt/photocollection-relay/2.6.1-20261016T122152Z/cloud_relay/`。修改前备份为 `Caddyfile.before-downloads-20261017T063500Z` 和 `compose.yaml.before-downloads-20261017T064251Z`。将来重建必须沿用原 Compose 项目名 `photocollection-relay` 和现有命名卷，不可执行 `down -v`，否则会删除证书和下载服务副本。

## 更新与回退

1. 将新版本放入独立版本目录，先核对完整 SHA-256、字节数和实际内容，不覆盖旧版本。
2. 将该目录复制至 Caddy 的 `/config/lumina-downloads/`，权限为目录 755、文件 644。扩展 Caddy 的精确文件路径允许列表，先运行 `caddy validate`，再热加载。单纯增加文件无需重建或停止 relay。
3. 测试两个文件的 HEAD、Range、附件文件名和摘要。验证通过后更新 `frontend/src/browser/windows-release.json` 中的版本、直链、备用地址、字节数和摘要，再构建并发布网页。
4. 快速回退可将网页默认地址改回已有 GitHub 备用地址并重新发布。回退代理配置应使用上述备份并验证、热加载；回退 BBR 使用原 Compose 配置，仅在没有活动中转连接时重建 https。

## 验证与容量边界

15 项逻辑测试、2 项 Windows 下载页回归及生产构建通过。浏览器回归覆盖两种下载线路、建议文件名、中英文、主题和窄屏，使用合成下载字节，不执行安装包。

真实服务器验证两个文件的 HEAD 长度、首尾 Range 字节与本机原包一致；对目录、未允许文件、父配置路径及 POST 请求返回 404。正式健康检查为 ready，合法来源 WebSocket 握手通过，错误来源返回 403；未发送 AI 密钥、照片或生成提交。

本机测试 BBR 调整前速度波动明显，慢速样本约 48–78 KB/s；调整后两次 4 MiB 样本分别为 1894575 和 1407830 字节/秒。样本不能证明所有地区或高并发的持续速度。现有服务器总带宽为 20 Mbps，理论合计上限约 2.5 MB/s，月流量包 512 GB，与 AI 中转共用；新增下载消耗该流量包，超额及续费按账户实际规则处理。流量增长时应迁移到对象存储与 CDN，不能承诺跑满访客宽带；未自动开通任何付费存储或 CDN。

持久配置生效后，另一次 16 MiB 连续分段下载耗时 8.818 秒，平均 1902565 字节/秒。正式浏览器验证两种包的真实下载响应文件名后取消传输，桌面和窄屏无脚本错误或横向溢出；实际截图位于忽略的 `.test-artifacts/live-browser/windows-direct-*.png`。

## 本次上线

已更新原项目，部署编号 `dpqm4s0f4hxb`，源提交 `81bba6ab21cb9b7192c150b8abbb83cfb41847d4`，构建时工作区干净。发布包为 `releases/Lumina-Web-20261017T064430271620Z/browser-static.zip`，SHA-256 为 `1a7778f2fbfe517da66b88a07e42dcb8eda4bce12ca4886d15fa285788cf1d0b`。

正式下载 HTML 和其中 10 个构建资源哈希均与本地一致。发布前确认作者草稿与正式清单一致；发布后核对清单完整一致，保留已有 18 张公开照片和 0 个影集。真实浏览器确认主下载指向本机服务器，备用下载指向原 GitHub Release，文件名仍为 1.0。
