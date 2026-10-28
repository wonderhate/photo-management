# Windows 2.7.0 下载与网站发布

正式站：https://photomanagement.online/；下载：https://photomanagement.online/windows.html；GitHub：https://github.com/wonderhate/photo-management/releases/tag/v2.7.0 。

Windows 两种包使用真实版本号 2.7.0，文件名、长度、摘要以 `frontend/src/browser/windows-release.json` 为准。主下载为现有 `https://ai.photomanagement.online/downloads/2.7.0/`，GitHub 为备用。Linux 2.6.1 预览单独标记，不冒充新版 Windows。旧 1.0 下载和旧 Release 均保留。

服务器复用原主机和 Compose 项目 `photocollection-relay`。源文件位于 `/opt/photocollection-downloads/2.7.0/`，服务副本在原持久卷 `/config/lumina-downloads/2.7.0/`；仅精确允许的三种文件通过 GET/HEAD 提供，不开放目录或写入。

中转镜像 `photocollection-relay:2.7.0` 支持 `/cloud-art` 与 `/cloud-studio`，原来源校验保留，未进行付费请求。活动中转连接为空时替换 relay；原镜像和配置保存在 `/opt/photocollection-relay/2.7.0-20261028/previous/` 及 `previous-image.txt`。

发现旧单文件绑定仍指向此前替换的 inode，因此将正式代理配置保存到持久卷 `/config/Lumina-Caddyfile-2.7.0`，验证并热加载后，让 https 启动命令显式使用此文件，再重建 https 一次。保留证书卷、下载卷、BBR、原有 `/hit` 与访问日志轮换。活动配置备份为 `/config/rollback-active-20261028.json`。后续重建必须保留现有生产 Compose 命令覆盖和项目名；不得执行 `down -v`。单纯添加下载仍只需文件复制与配置热加载。

两个发布包在主机和服务卷内完整 SHA 通过；HTTPS HEAD 字节数、附件下载、首尾 Range 206 与本机原包一致。未允许路径、目录和 POST 返回 404；旧包 HEAD 长度不变。GitHub 下载内容已由服务器完整摘要验证。

EdgeOne 原项目部署编号 `dphp0qz601nx`；版本包 SHA-256 为 `4e8b3bf9a924a21d5ad04a3252ac667850fc3a7849f34dd110ade5b0ac87e703`。线上七条中英路由、窄屏、跳过图库和稍后导入、下载入口和正式 HTML 哈希通过。18 张作品、主题与中英导航保持原有逻辑。

回退：重新部署本机保留的上一网站 ZIP，或将下载元数据改回旧直链后构建；中转可使用保留的旧镜像和配置。回退 Caddy 用已备份的活动 JSON 验证、热加载，不删除证书与下载卷。现有带宽和流量包保持原配置，没有购买新资源。

Windows 为公开试用，覆盖安装、跨版本升级及卸载尚待验收；此次不修改现有注册安装。

最终生产复验：177 个公开资源逐文件 SHA 与本地一致；发现并修复 ONNX `.mjs` 被静态主机当作二进制类型的问题，构建按准确资源名生成 JavaScript/WASM MIME 规则，同时将规则纳入离线缓存版本。生产 JavaScript/WASM 类型、单一 Worker CSP 和页面隔离头通过，增强后的展示整合 17 项再次通过。此前初次部署 `dpikreru7nds` 的包保留用于追溯。


## 2.7.1 最终更新

当前 Windows 版本为 2.7.1，直链位于 `/downloads/2.7.1/`，GitHub 发布为 `v2.7.1`。2.7.0、1.0 与 Linux 2.6.1 均保留。

正式部署 `dprx8vykpso1`，网站 ZIP SHA-256 为 `0c2a5446990aa9997ba19ec51ac6f038f2d8e9b9fc7981f81dc458b0518104b0`。18 张照片及原有作品、导航、语言和主题逻辑保持一致；177 个公开文件的 SHA、JavaScript/WASM 类型和安全头全部通过，线上七条路由、窄屏、图库跳过和稍后导入提示、2.7.1 下载入口通过。两个 Windows 包在 GitHub、主机和服务卷内完整 SHA 一致，HTTPS HEAD 与首尾 Range 通过。

Caddy 沿用历史命名的活动文件 `/config/Lumina-Caddyfile-2.7.0`，已热加载三个版本的精确文件允许列表；重建仍使用原 Compose 命令和命名卷。更新前备份为 `/config/Lumina-Caddyfile.before-2.7.1`。此次仅更新下载配置，没有重启中转。
