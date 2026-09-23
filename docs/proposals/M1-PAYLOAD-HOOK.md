# 固定源码的请求 payload hook（已授权实施）

基于 `00102833dfaee1da9f48a3a8eae9d34005a75218`。原始审阅差异为 [00102833-payload-hook.patch](00102833-payload-hook.patch)，只涉及 `packages/llm/llm-pi-ai/src/adapter.ts` 和 `index.ts`。用户随后明确授权实施，fork 中已应用实现并补齐测试、字段说明和中英文文档；未提交、未推送、未更新 pin 或批准产品组合。实际结果见 [M1 记录](../IMPLEMENTATION-M1.md)。原始提案差异保留用于授权追溯，不代表追加测试和文档后的完整差异。

## 证据与必要性

- Desktop 的 `runtime-src/desktop-cache-key.mjs` 在最终 OpenAI payload 上只设置或移除 `prompt_cache_key`，按 home、提供方、协议、地址、模型和 session 生成 HMAC。现有用户可以选择 native/off/session。
- 新源码 `adapter.ts` 的 `streamWithSnapshot()` 仍调用 pi-ai 的 `streamSimple()`，但没有把 `onPayload` 接入其选项；`PiAiAdapterOptions` 和插件设置也没有对应入口。
- 固定依赖 pi-ai 的 `dist/types.d.ts` 声明了 `onPayload`，但仅依赖声明不能使 Harness 的生产调用路径传入它。
- 公共 `llm/stream` 接收 Harness 的逻辑请求，而非最终协议 payload；LOOP 请求不可变，改写内容还会违反日志可重建约束。它不能代替所需的最终缓存路由字段 hook。
- 现有内存扩展绑定旧 adapter hash 与源码锚点；源码升级后的结构变化必须审查，不能更换 hash 继续注入。另造适配器会复制提供方注册、凭据、模型快照和请求转换，不符合最小维护范围。

## 最小实现

提供可选的 `llm-pi-ai/prepare-payload` bail 事件，将无正文、无 Key 的路由事实传给桌面插件。监听器在凭据 await 前返回按本次请求冻结的 `onPayload` 回调；没有监听器时不向 pi-ai 增加选项。桌面的 off/session 策略、HMAC 和 Windows 凭据仍留在桌面仓库，不进入 Harness。

hook 的契约限定为传输路由元数据：不得改写日志中的系统提示、消息、工具或生成参数。此次消费者只处理 `prompt_cache_key`。回调执行错误应让请求失败，不得吞错后发送与用户设置不一致的请求。事件不做后台补发，不引入第二个 Agent Loop。

链接中的差异保留了授权时的最小实现草案；配套类型检查、文档和定向测试已完成，新的来源固定及产品集成仍待完成。新增事件要求补齐类型归属与 API 目录，未增加豁免；最终共 12 个文件，其中运行时实现仍只有最初两个文件，其余为测试、说明、映射和生成目录。[完整审阅差异](../evidence/m1/harness-hook-review.patch) 和 [逐文件哈希/测试记录](../evidence/m1-20260923.json) 保存最终范围。不能把 `apply --check` 当成可构建证明。

## 授权后的验证

1. Harness 定向测试：无监听器选项完全一致；hook 正好捕获一次；凭据 await 期间改变策略不会改变已捕获回调；下一次请求使用新策略；失败不发送请求；取消和重试沿用原生语义。
2. 桌面本地双协议 HTTP：native/off/session、已知与自定义提供方、同名模型、会话和环境隔离、重启稳定；比较最终 body，仅允许声明的缓存路由字段差异。校验消息、工具、前缀、usage 和取消，不使用真实服务或用户数据。
3. 运行对应类型/文档/构建检查，重新打包独立源码产物并绑定新 pin；全部桌面 Gate 通过前保持正式准入关闭。

用户要求修改 fork hook 必须先获明确授权，本次在收到授权后才修改。尚未产生包含 hook 的固定源码产物或原生候选交付。
