# 旧版 Node 原型

这里归档了早期 Express 网页原型、静态界面与测试。当前程序使用根目录启动脚本、`backend/` 和 `frontend/`，不依赖此原型。

原项目根目录的 `uploads/`、`thumbnails/`、`signatures/` 与 `data/` 保留在原位，未移动照片或旧用户数据。此目录只归档代码。

如需单独研究原型：在此目录 `npm ci`，然后 `node server.js`（端口 5500）。它会建立自己目录下的演示数据。当前系统使用 8000 端口和 SQLite，请勿把旧 JSON 库当成当前库。

测试：根目录 `npm run test:legacy`；需要先安装此目录的旧依赖。原型没有参与本次现代系统的功能扩展。
