# 中国地区离线地图下载与覆盖说明

2026-11-03：1167 个可用源格网、70 个地区 PMTiles 包全部制作完成，并通过大小、SHA-256、PMTiles 元数据及分区来源校验。整套分区合计 28,301,751,554 字节（约 26.36 GiB），请只下载所需地区。

地图作为 [2.7.4 Release 的独立资产](https://github.com/wonderhate/photo-management/releases/tag/v2.7.4)分发，不进入 Git、应用安装包或静态网站包。正式发行前这些资产保留在发布草稿内，公开链接在 Release 发布后生效。

下载同一 Release 中的 `china-10m-2021-manifest.json` 和 `SHA256SUMS-maps-2021.txt`。清单记录每个包的字节数、SHA-256、源格网和下载链接。用 PowerShell `Get-FileHash -Algorithm SHA256 <文件>` 或 `sha256sum <文件>` 核对后，在「拍摄地点 → 离线地图包」选择所需 `.pmtiles` 文件，可多选安装。浏览器会复制到本机地图存储，需为下载文件和安装副本保留空间；文件不会上传到网站服务器。

来源为 ESA WorldCover 2021 RGBNIR，CC BY 4.0；Contains modified Copernicus Sentinel data (2021)。这是以约 10 米源影像生成的真彩色 WebP 地图，缩放级别 6–14，不表示每一级瓦片都具有独立的 10 米地面采样。源目录中有 96 个不可用格网，包含已记录的永暑礁（Yongshu）等缺口；不能宣称全部地区均有 10 米影像。未安装或未覆盖地区回退到 NASA 全球概览。详见 [地图使用与来源](offline-photo-map.md)。

文件名中的 E/N 表示分区西南角经纬度，分区通常为 5° × 5°；边境和岛屿分区仅包含实际可用源格网，准确覆盖以清单及包内范围为准。

| 分区文件 | MiB | 下载 |
| --- | ---: | --- |
| china-10m-2021-e070-n35.pmtiles | 191.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e070-n35.pmtiles) |
| china-10m-2021-e070-n40.pmtiles | 68.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e070-n40.pmtiles) |
| china-10m-2021-e075-n30.pmtiles | 263.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e075-n30.pmtiles) |
| china-10m-2021-e075-n35.pmtiles | 684.2 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e075-n35.pmtiles) |
| china-10m-2021-e075-n40.pmtiles | 343.2 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e075-n40.pmtiles) |
| china-10m-2021-e080-n25.pmtiles | 117.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e080-n25.pmtiles) |
| china-10m-2021-e080-n30.pmtiles | 532.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e080-n30.pmtiles) |
| china-10m-2021-e080-n35.pmtiles | 447.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e080-n35.pmtiles) |
| china-10m-2021-e080-n40.pmtiles | 718.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e080-n40.pmtiles) |
| china-10m-2021-e080-n45.pmtiles | 286.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e080-n45.pmtiles) |
| china-10m-2021-e085-n25.pmtiles | 390.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e085-n25.pmtiles) |
| china-10m-2021-e085-n30.pmtiles | 493.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e085-n30.pmtiles) |
| china-10m-2021-e085-n35.pmtiles | 512.3 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e085-n35.pmtiles) |
| china-10m-2021-e085-n40.pmtiles | 649.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e085-n40.pmtiles) |
| china-10m-2021-e085-n45.pmtiles | 627.2 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e085-n45.pmtiles) |
| china-10m-2021-e090-n25.pmtiles | 400.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e090-n25.pmtiles) |
| china-10m-2021-e090-n30.pmtiles | 634.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e090-n30.pmtiles) |
| china-10m-2021-e090-n35.pmtiles | 507.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e090-n35.pmtiles) |
| china-10m-2021-e090-n40.pmtiles | 472.7 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e090-n40.pmtiles) |
| china-10m-2021-e090-n45.pmtiles | 181.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e090-n45.pmtiles) |
| china-10m-2021-e095-n20.pmtiles | 170.7 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e095-n20.pmtiles) |
| china-10m-2021-e095-n25.pmtiles | 537.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e095-n25.pmtiles) |
| china-10m-2021-e095-n30.pmtiles | 685.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e095-n30.pmtiles) |
| china-10m-2021-e095-n35.pmtiles | 643.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e095-n35.pmtiles) |
| china-10m-2021-e095-n40.pmtiles | 387.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e095-n40.pmtiles) |
| china-10m-2021-e100-n20.pmtiles | 384.3 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e100-n20.pmtiles) |
| china-10m-2021-e100-n25.pmtiles | 677.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e100-n25.pmtiles) |
| china-10m-2021-e100-n30.pmtiles | 638.2 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e100-n30.pmtiles) |
| china-10m-2021-e100-n35.pmtiles | 643.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e100-n35.pmtiles) |
| china-10m-2021-e100-n40.pmtiles | 215.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e100-n40.pmtiles) |
| china-10m-2021-e105-n05.pmtiles | 0.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n05.pmtiles) |
| china-10m-2021-e105-n10.pmtiles | 24.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n10.pmtiles) |
| china-10m-2021-e105-n15.pmtiles | 45.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n15.pmtiles) |
| china-10m-2021-e105-n20.pmtiles | 425.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n20.pmtiles) |
| china-10m-2021-e105-n25.pmtiles | 596.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n25.pmtiles) |
| china-10m-2021-e105-n30.pmtiles | 627.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n30.pmtiles) |
| china-10m-2021-e105-n35.pmtiles | 711.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n35.pmtiles) |
| china-10m-2021-e105-n40.pmtiles | 285.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e105-n40.pmtiles) |
| china-10m-2021-e110-n00.pmtiles | 49.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n00.pmtiles) |
| china-10m-2021-e110-n05.pmtiles | 1.7 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n05.pmtiles) |
| china-10m-2021-e110-n10.pmtiles | 1.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n10.pmtiles) |
| china-10m-2021-e110-n15.pmtiles | 31.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n15.pmtiles) |
| china-10m-2021-e110-n20.pmtiles | 419.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n20.pmtiles) |
| china-10m-2021-e110-n25.pmtiles | 580.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n25.pmtiles) |
| china-10m-2021-e110-n30.pmtiles | 646.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n30.pmtiles) |
| china-10m-2021-e110-n35.pmtiles | 793.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n35.pmtiles) |
| china-10m-2021-e110-n40.pmtiles | 447.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n40.pmtiles) |
| china-10m-2021-e110-n45.pmtiles | 39.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e110-n45.pmtiles) |
| china-10m-2021-e115-n00.pmtiles | 91.3 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n00.pmtiles) |
| china-10m-2021-e115-n05.pmtiles | 78.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n05.pmtiles) |
| china-10m-2021-e115-n10.pmtiles | 0.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n10.pmtiles) |
| china-10m-2021-e115-n20.pmtiles | 176.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n20.pmtiles) |
| china-10m-2021-e115-n25.pmtiles | 564.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n25.pmtiles) |
| china-10m-2021-e115-n30.pmtiles | 618.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n30.pmtiles) |
| china-10m-2021-e115-n35.pmtiles | 613.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n35.pmtiles) |
| china-10m-2021-e115-n40.pmtiles | 695.3 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n40.pmtiles) |
| china-10m-2021-e115-n45.pmtiles | 366.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n45.pmtiles) |
| china-10m-2021-e115-n50.pmtiles | 48.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e115-n50.pmtiles) |
| china-10m-2021-e120-n20.pmtiles | 90.7 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n20.pmtiles) |
| china-10m-2021-e120-n25.pmtiles | 116.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n25.pmtiles) |
| china-10m-2021-e120-n30.pmtiles | 160.8 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n30.pmtiles) |
| china-10m-2021-e120-n35.pmtiles | 150.1 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n35.pmtiles) |
| china-10m-2021-e120-n40.pmtiles | 704.3 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n40.pmtiles) |
| china-10m-2021-e120-n45.pmtiles | 672.0 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n45.pmtiles) |
| china-10m-2021-e120-n50.pmtiles | 526.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e120-n50.pmtiles) |
| china-10m-2021-e125-n40.pmtiles | 585.6 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e125-n40.pmtiles) |
| china-10m-2021-e125-n45.pmtiles | 662.5 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e125-n45.pmtiles) |
| china-10m-2021-e125-n50.pmtiles | 248.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e125-n50.pmtiles) |
| china-10m-2021-e130-n40.pmtiles | 112.9 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e130-n40.pmtiles) |
| china-10m-2021-e130-n45.pmtiles | 473.4 | [PMTiles](https://github.com/wonderhate/photo-management/releases/download/v2.7.4/china-10m-2021-e130-n45.pmtiles) |
