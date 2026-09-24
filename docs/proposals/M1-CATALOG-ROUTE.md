# 独立连接路由继承固定内置提供方（已授权实施）

用户于 2026-09-24 明确授权并要求继续推进。接口已随 fork 本地提交 `5e2879f0478ba9336128312e715dee7a9f56c3db` 实施；运行时仅改动下述三个文件。另修正此前 payload hook 的事件注释与文档扫描器对 `ctx.bail` 的识别，未改变 payload 行为。原始问题与方案保留如下，交付准入由完整桌面 Gate 单独决定。

## 已核实的问题

固定 dad014b7 的 llm-pi-ai 使用 providers 的键同时查找内置目录和标识连接。桌面为了同时显示两份同名模型，将连接映射到 desktop-p-… 路由后，catalogModels 与 catalogProvider 无法找到默认提供方。因此模型会丢失 reasoning、input、thinkingLevelMap、部分 compat 等继承字段。

不能靠桌面复制所有配置解决：catalog.ts 明确将 zaiToolStream、deferredToolsMode、supportsMidConvoEffort、allowedFallbackModels 等标记为 withhold，公开 profile schema 不允许写入这些字段。绕过 schema 或替换私有内部实现都不合适。现有 payload hook 只授权传输缓存元数据，也不能代替模型目录继承。

已用实际 source Host 的 `session/modelCatalog` RPC 复现：相同 Rust preset 配置换成独立路由后，ZAI、Anthropic、DeepSeek 合计 27 个模型的 reasoning 选项消失，零模型请求。见 `../evidence/0.2.5/source-catalog-alias-blocker.json`。可用 `node tests/source-catalog-alias-probe.mjs <qualification-resources>` 重现，检测到差异时明确返回 BLOCKED/退出码 2，不计为通过。未修改 fork。

## 最小可审阅实现范围

仅在 llm-pi-ai 增加可选的 `catalogProvider?: string` 配置字段，表示固定安装目录的继承来源，非 URL/路径/动态模块：

1. config.ts 的 PiAiProviderProfile 和 profile schema 增加此字段，传给 resolveRouteModels 与 buildProvider。
2. catalog.ts 的 RouteCatalogRequest 增加同名字段。仅两个目录读取使用 `request.catalogProvider ?? provider`；显式来源不存在时报 PiAiCatalogError。输出模型仍使用原 route 的 provider、原配置 endpoint 和模型覆盖。
3. provider.ts 的 ProviderSpec 增加字段，目录读取使用 `spec.catalogProvider ?? spec.provider`。其余原生 protocol、auth、models 注册路径保持现有逻辑。

未设置字段时行为与当前版本相同。身份、请求 scope、凭据引用、session 选择与缓存隔离继续绑定独立 route，不绑定继承来源。桌面仅对明确选择的内置 preset 写入此字段；自定义内网提供方仍需完整手工配置。主密钥仍来自私有监督管道，禁止因别名失效回退到其他连接密钥。

预计运行时改动仅上述 3 个文件；配套增加定向测试、字段说明和 API 目录，不扩大为新的 Agent Loop 或私有 provider 副本。尚未修改 fork。

## 验证和准入

- 固定目录中 ZAI/Anthropic/DeepSeek 等别名模型与原路由的能力、完整 compat、input、thinkingLevelMap 相等；只允许 route/endpoint/显式模型覆盖不同。
- 两个相同继承来源的别名具有不同凭据与 endpoint；别名请求 scope 不串路由；暂停旧请求期间变更不影响旧快照。
- 无此字段原测试全部保留；不存在/空来源拒绝，原未知自定义路由仍可配置；原协议覆盖语义保留。
- 双协议本地 mock 验证思考、工具、重试、缓存最终请求及不同连接，不访问真实 Provider。
- 运行 fork 要求的类型/测试/文档 Gate，重新构建完整源码产物，重新记录 commit 和模块 hash；桌面完整 Gate 仍是交付前置条件。

依据用户最初要求，新增 fork 接口前需明确授权。先完成本提案后询问；不因已获 payload hook 授权而默认扩大 fork 修改范围。
