# Windows 2.7.0 下载与网站发布

正式站：https://photomanagement.online/；下载：https://photomanagement.online/windows.html；GitHub：https://github.com/wonderhate/photo-management/releases/tag/v2.7.0 。

Windows 两种包使用真实版本号 2.7.0，文件名、长度、摘要以 `frontend/src/browser/windows-release.json` 为准。主下载为现有 `https://ai.photomanagement.online/downloads/2.7.0/`，GitHub 为备用。Linux 2.6.1 预览单独标记，不冒充新版 Windows。旧 1.0 下载和旧 Release 均保留。

服务器复用原主机和 Compose 项目 `photocollection-relay`。源文件位于 `/opt/photocollection-downloads/2.7.0/`，服务副本在原持久卷 `/config/lumina-downloads/2.7.0/`；仅精确允许的三种文件通过 GET/HEAD 提供，不开放目录或写入。

中转镜像 `photocollection-relay:2.7.0` 支持 `/cloud-art` 与 `/cloud-studio`，原来源校验保留，未进行付费请求。活动中转连接为空时替换 relay；原镜像和配置保存在 `/opt/photocollection-relay/2.7.0-20261028/previous/` 及 `previous-image.txt`。

发现旧单文件绑定仍指向此前替换的 inode，因此将正式代理配置保存到持久卷 `/config/Lumina-Caddyfile-2.7.0`，验证并热加载后，让 https 启动命令显式使用此文件，再重建 https 一次。保留证书卷、下载卷、BBR、原有 `/hit` 与访问日志轮换。活动配置备份为 `/config/rollback-active-20261028.json`。后续重建必须保留现有生产 Compose 命令覆盖和项目名；不得执行 `down -v`。单纯添加下载仍只需文件复制与配置热加载。

两个发布包在主机和服务卷内完整 SHA 通过；HTTPS HEAD 字节数、附件下载、首尾 Range 206 与本机原包一致。未允许路径、目录和 POST 返回 404；旧包 HEAD 长度不变。GitHub 下载内容已由服务器完整摘要验证。

EdgeOne 原项目部署编号 `dpikreru7nds`；版本包 SHA-256 为 `9d3e5f126e546073da5141637ce66a0c2b71a2fa5884b81722e3f1e0d2828bd5`。线上七条中英路由、窄屏、跳过图库和稍后导入、下载入口和正式 HTML 哈希通过。18 张作品、主题与中英导航保持原有逻辑。

回退：重新部署本机保留的上一网站 ZIP，或将下载元数据改回旧直链后构建；中转可使用保留的旧镜像和配置。回退 Caddy 用已备份的活动 JSON 验证、热加载，不删除证书与下载卷。现有带宽和流量包保持原配置，没有购买新资源。

Windows 为公开试用，覆盖安装、跨版本升级及卸载尚待验收；此次不修改现有注册安装。
