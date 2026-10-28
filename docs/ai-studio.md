# 国内 AI 工作室与加密设置迁移

这是 `codex/afterframe-upgrade` 开发分支的能力说明，不代表已发布新安装包。固定十项 AF12、AF35、AF49–AF56 的验证结果以 [实施登记](afterframe-upgrade-plan.json) 为准。

## 账户与供应商

从附属导航进入“AI创作与标注”，展开“国内AI账户配置”。账户名称、供应商、地区、模型和密钥属于独立配置；已有水彩工坊继续使用自己的地址与凭证。

| 配置 | 图像生成 | 视觉标注 | 地址与限制 |
| --- | --- | --- | --- |
| 官方千问 | Qwen Image 3.0 / Pro、Image Edit Plus | Qwen 视觉模型 | 中国北京；可填写专属工作空间 ID；Edit Plus 必须提供参考图；按模型返回尺寸保存 |
| 火山方舟 | Seedream 4.0 / 4.5 或对应接入点 ID | 此适配器不支持 | 中国北京；单图、2K 请求；不替换为其他供应商重试 |

保存配置不会调用模型，也不验证余额或服务权限。Windows 使用当前用户的 DPAPI 加密密钥；浏览器只在当前会话保存密钥，重新加载或切换图库后需要重新输入。改变供应商、地区或工作空间会清除旧密钥。删除配置保留历史结果。

浏览器还需要配置可信转发服务。AI 工作室使用 `/cloud-studio`，可复用水彩转发服务的主机地址，但不共享水彩密钥。转发服务会收到当前账户密钥和去除元数据的照片，再请求所选供应商。远端地址要求 WSS；本机开发地址限 `127.0.0.1` / `localhost:9000`。本功能不会自行部署或连接公共转发服务。

协议依据：[千问图像生成与编辑](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)、[千问视觉理解](https://help.aliyun.com/en/model-studio/vision)、[方舟图像生成](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh&redirect=1)。模型可用性与账户权限仍由供应商决定。

## 照片标注

1. 选择账户、单张或多选照片、影集，或某次导入的新增照片。支持在所选范围中只处理缺少标注的照片；每次最多100张，超出时需要缩小范围。
2. 选择中英双语或单一语言、最多30个标签概念、每种语言30–1500字的描述上限，以及是否识别画面文字、是否提供地点猜测。
3. 点击“检查范围与数量”，核对冻结的照片清单、数量和模型。确认有效期为10分钟；更改配置或范围后需要重新核对。
4. 勾选发送与计费确认，再启动任务。导入结束时的入口只提供建议，不会自动发送新照片，也不会补扫历史照片。

标注请求只发送重建像素后的压缩图片：桌面最长边不超过1536，浏览器不超过1024。EXIF、GPS、原始文件名和目录不进入图片请求；调用前后核对原片 SHA-256。原片文件始终只读。

结果采用版本化 JSON，包括双语描述、成对翻译的标签、OCR文字及可选地点猜测。程序执行字段校验、Unicode规范化、数量和长度限制、重复概念对去重，不把相近但不同的概念强行合并。人工描述、人工添加的标签和已拒绝的AI标签按既有来源规则保留。

地点猜测显示置信值和依据。确认或否决仅记录人工审核状态，不写入GPS，也不把猜测变成已知坐标。照片原有地点与人工地点功能保持独立。

格式有误但包含文本的结果保留在本地，可编辑 JSON 后应用，不再次调用模型。来源或标注版本已变化时，旧结果不会直接覆盖新状态。

## 风格重绘与手写字

风格重绘提供25份可查看提示词的预设和自定义提示词。选择照片、风格和账户后，仍需明确确认才提交。不同模型的输出尺寸不保证等于原片；比较视图保持图片比例，不拉伸原片。专用水彩模板及本地海报排版不受影响。

手写字支持准确文字、可选参考图和画风要求。生成黑白图后，本地根据亮度生成透明度；改变颜色、位置、大小和导出PNG均不再次调用模型。生成的文字仍可能有错字，需要人工核对后才能导出，也可直接弃用。原有本地字体署名继续可用。

每次生成产生独立记录和图片，保存供应商、模型、请求编号、提示词及来源哈希。继续同一来源生成可关联上一版本；查看旧版本和原片对比不计费。来源关系图可查看照片、AI结果和前后版本关系。旧水彩作品和已保存水印来源快照不会因AI新版本改变。

弃用结果只移除记录。生成文件由既有派生文件回收流程管理，在用结果的图片、预览和原始手写生成图受到引用保护。图库复制和备份包含AI记录与生成文件；合并遇到不同内容占用同一结果ID时拒绝覆盖。

## 任务与检索

逐张任务记录成功、失败、供应商、模型、请求编号和计费状态。取消停止后续请求，已完成结果保留；已提交请求仍可能计费。连接中断或超时不会自动重发计费POST，不会自动切换供应商。需要重新生成时，由用户重新确认新任务。

AI描述、OCR和双语标签使用既有 QueryAST、文字索引和照片来源字段。工作室提供按AI描述、OCR或完整标签浏览结果的入口；照片库中的语义相似搜索仍是独立能力，不被文字包含查询代替。

## 加密设置迁移

设置页可选择图库显示、筛选栏、工具偏好，以及语言和主题。默认不包含密钥；照片、作品和原片目录不进入设置包。选中的设置使用随机盐、PBKDF2-SHA256（310000次）和AES-256-GCM加密；错误口令、篡改或不支持的包版本会被拒绝。

“另外包含全部AI工作室账户及已配置密钥”默认关闭。启用后只包含AI工作室账户，专用水彩密钥仍不在包中。读取加密包后先展示待导入类别、账户数与含密钥数量，再明确确认。偏好合并和新账户写入在同一次图库事务完成；账户导入不会覆盖既有账户，也不会调用模型。Windows密钥重新加密，浏览器导入密钥仍只保留在会话中。

## English overview

AI Studio adds explicitly authorized Qwen/Ark image generation, handwriting, bilingual captions, tags, OCR, human-reviewed place hypotheses, immutable local results and exact-field search. Watercolor retains its separate endpoint and credential. Original photos are read-only; images are sanitized before upload. Cloud requests are never retried automatically, and changing ink color, placement or historical versions is local.

Encrypted settings transfer uses PBKDF2-SHA256 and AES-GCM. Keys are excluded by default. An optional AI Studio account bundle is previewed before import; imported browser keys remain session-only. No new installation or deployment is implied by this development-branch documentation.
