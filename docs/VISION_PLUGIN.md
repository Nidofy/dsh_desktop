# 识图插件

工作区左下角「设置 → 插件 → 插件配置 → 识图」。支持 OpenAI Chat Completions 和 Anthropic Messages 两种格式，各自填写 API 基础地址（包含服务要求的 `/v1`）、模型 ID 和密钥。程序分别追加 `/chat/completions`、`/messages`。默认关闭；设置立即生效。

提供 `analyze_image(file_path, question)`，适合主模型不能直接识图时分析工作区截图、图表或提取文字。图片通过 DSH 文件服务读取和原生图片解码器验证，再发送到独立识图服务。支持 PNG、JPEG、WebP、GIF，单图上限 10 MiB；只发送该图与问题，不附带整个会话或项目代码。

密钥复用 DSH 原生凭据服务，普通设置只存凭据引用。表单不回显密钥，留空保留；网络与 CA 继承当前桌面连接的运行环境。服务错误不回显响应正文，不自动重试，也不跟随重定向。默认超时 120 秒、最大输出 4096 tokens，可调整。

当前入口为工具读取本地图片。它不改变主模型自身的多模态能力，也未将聊天输入框的所有附件自动转发给该服务。

测试：`node tests/vision-provider.mjs` 验证请求格式、鉴权、限制、超时取消和错误处理；`node tests/observability-wire.mjs runtime --vision-only` 使用真实 DSH 的工具、文件、图片和凭据服务验证两种协议及重启后的配置保留。模拟服务仅绑定回环地址。
