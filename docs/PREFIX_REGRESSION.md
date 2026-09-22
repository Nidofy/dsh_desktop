# 缓存前缀回归

0.2.0 开发基线新增构建门禁，使用捆绑 DSH 0.1.5-rc.2 的真实引擎、标准 Agent preset 的隔离副本及本机合成 HTTP 服务。检查最终 OpenAI / Anthropic 请求，不连接真实模型，不读取用户项目和用户 Skill 目录，也不在日常会话中保存完整 HTTP 正文。

## 检查范围

每个协议 19 项：连续两次原生文件读取后的追加、多轮续聊、503 重试原始字节一致、重试轮前缀、换端口重启恢复、Skill 加载开始/正文追加、目录更新、AGENTS.md 刷新、权限切换、工具启用/注册顺序/停用、压缩总结请求、压缩检查点替换、压缩后续聊、模型切换及切换后续聊。

- `EXPECTED_APPEND`：先前系统提示、工具清单、缓存路由及消息内容保留，只增加消息或内容块。
- `EXPECTED_IDENTICAL`：模型可见提示相同；重试案例额外要求整个 HTTP JSON 正文字节相同。
- `EXPECTED_CACHE_BREAK`：只允许案例声明的变化。例如工具增删仅允许 TOOLS，压缩检查点仅允许 MESSAGES；模型切换允许 MODEL / SYSTEM，并单独断言系统提示只替换原生 persona 中的模型名。
- `UNEXPECTED_PREFIX_REWRITE`：超出允许范围的改写或未实际触发预期变化，构建失败。

Anthropic 的字符串内容和单个 text block 按等价内容比较；仅在已知协议位置剥离 `cache_control`，同时单独记录标记是否变化。工具 JSON Schema 中同名字段仍参与比较。保留消息角色、工具调用 ID、内容块边界与工具顺序，不用全局排序掩盖变化。其他请求选项的变化另列 `requestOptionsChanged`，不会冒充内容前缀变化。

报告计数单位是消息或消息头/内容块，**不是 token 数或服务端 KV cache 前缀长度**。本机通过不能证明内网网关已缓存、保留了多少时间或有某一命中率。计费与命中效果仍需真实连接的 Cache Probe 和实际任务验证。

## 已修复：重启随机端口改写系统提示

原生 Web surface section 包含 `http://127.0.0.1:<port>`。桌面重启后随机端口改变，会改写系统提示，即使整个旧消息前缀保持原样。

桌面插件通过 DSH 的 `system-prompt/assemble` / `systemPrompt.context` 扩展接口处理这一处已确认的变化：

1. 保留原生界面说明，仅把地址引用改为“当前 desktop runtime context 中的 URL”。
2. 当前地址进入原生持久 runtime-context snapshot；重启后追加最新地址，不修改旧消息。
3. 地址不含认证令牌；原生 `DSH_WEB_URL` shell 环境变量不受影响。
4. 自定义 Web section 不匹配时不改写；preset 禁用 runtime context 时保留原生 section，不丢失地址信息。完整自定义 prompt 的原生优先级不变。

该行为与诊断采集开关无关。没有修改捆绑 DSH 源码、固定服务端口、再排序工具或重写压缩算法。首次升级到此实现会改变一次 system prompt；后续相同配置的重启不再因端口而改写。升级模型、工具或 preset 仍可能产生合理的前缀变化。

## 开发运行

```powershell
./runtime/runtime/node.exe scripts/sync-desktop-runtime.mjs
./runtime/runtime/node.exe tests/prefix-regression.mjs
./runtime/runtime/node.exe tests/prefix-regression-wire.mjs
```

原生回归依赖 Rust 配置测试先生成 `.build/config-protocol-fixtures`，与现有协议回归相同。构建脚本已按顺序执行。Windows 文件读取沿用产品沙箱；需要能创建原生 restricted token 的正常开发宿主环境。

`.build/prefix-wire-*/report.json` 保存分类和计数；测试目录里的 `synthetic-wire.json` 只保存合成 fixture 请求，`engine.log` 可能含临时本机登录链接，不应作为脱敏报告公开。退出会停止测试引擎与本机服务。该门禁是开发测试，目前尚未接入内网自检中心。
