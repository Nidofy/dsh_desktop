# 0.2.5 实施记录

本记录接续 [M1 基线与首轮验证](IMPLEMENTATION-M1.md)。目标为隔离的源码 Harness / Tauri 候选，当前未达到交付 Gate。用户于 2026-09-24 授权本地提交及后续里程碑自动提交；不推送、不发布。

## 已完成里程碑

### S1：请求 payload 扩展接口和基础保护

Harness fork 已提交 `dad014b7efd3e1d76a36e6bd9646487d28d9037e`。运行时只改动两个 LLM 文件，其余为定向测试及 API 文档/目录。提交时发现 README 工作树 CRLF 与 Git LF 规范使配对记录不一致，规范换行并重新记录后，全部 pre-commit 检查通过；没有跳过检查。首轮的 71 项回归、后续 6 项 hook、23 项目录消费者结果详见 M1 记录。

桌面 pin 已指向该提交。源码准入仍为 false；本轮下一步先构建并验证隔离候选，再完成产品准入。原始 16 个未提交文件的备份保持不变。历史 M1 证据记录的是提交前状态，不回写历史测试事实。

## 后续里程碑及 Gate

### S5e：独立连接继承内置模型目录（2026-09-24）

用户授权最小 `catalogProvider` 接口后，fork 已本地提交 `5e2879f0478ba9336128312e715dee7a9f56c3db`。目录默认值与连接身份分离，桌面仅为已识别 preset 写入继承来源；自定义连接保持手工模型配置。完整 compat、reasoning、input 等字段通过整个模型对象比较验证，暂停旧请求期间更换配置仍保持旧 endpoint/key/scope。真实 Loader 配置加载、类型、lint、42 项文档 Gate 和提交检查通过。详见 `evidence/0.2.5/catalog-provider-fork.json`。

完整文档检查同时发现并修复此前 payload hook 的 scoped 注释及 `ctx.bail` 扫描遗漏，没有更改 payload 行为。额外 SDK `text-turn` 回放在 Windows 的 feedback 断言失败，重新构建后相同；原因尚未确定，单独保留失败记录，不冒充桌面或 SDK 回放通过。新源码产物已封存 27,876 文件、275 个工作区生产包；桌面 0.2.5-rc.1 的全量 Gate 与最终原生验收继续执行。

S5e 后续验证：新提交资格目录封存 28,219 个文件，实际 Host RPC 对照 ZAI 10、Anthropic 14、DeepSeek 3 个模型，27 个模型全部一致（`source-catalog-alias.json`）。双协议热应用在新产物上复测通过（`source-catalog-hot-wire.json`）。据此前原生宿主验证及本轮源码接口验证，构建组合准入已开启；这只允许完整桌面 Gate，最终交付状态仍以该 Gate 和最终 EXE 原生验收为准。

### S5d：热切换诊断标记与比较（2026-09-24）

单次请求此前已冻结配置指纹，但汇总报告仍可能引用启动时连接，影响热切换后的归档/比较。现在每个请求仅记录协议及 HMAC 连接/凭据标记；不同修订混合时汇总身份为空，按会话或轮次筛选后重新计算。迟到旧请求不覆盖新请求标记，凭据原文、引用和 endpoint 不进入新增导出字段。A/B 比较检查请求级连接与凭据变化，同时保持明确预算实验的既有分类。

观察器、比较/归档/隐私、真实 DPAPI 设置事务、模块同步及命令权限检查通过；新增双协议热切换断言见 `source-diagnostic-hot-wire.json`。最终模块完整双协议回归见 `source-diagnostic-full-wire.json`，仍包含工具/工程操作、缓存、鉴权、取消、冷恢复不重放与设置持久化全部既有断言。资格目录 28,219 文件封存通过；此纯诊断变更尚未在最终交付 EXE 复测。旧 settings writer 相关单测显式使用保留的旧 runtime，新 profile 有单独契约覆盖。

### S4b/S5c：原生权限、隔离首屏及完整功能定向检查（2026-09-24）

真实 Tauri 窗口发现“应用连接”被 ACL 拒绝，补齐 `connection_apply_mode` 的命令声明及仅本地 shell 窗口权限。窗口复测成功，旧请求配置保持不变，后端 PID 不变。新增前端静态 invoke 与命令/窗口权限的交叉检查，未给远端 Web 或 pet 窗口增加该权限。

首屏还发现新版 `workspace.initializeDefault` 独立查询 Documents，cwd 隔离不足以约束默认工作区。现在通过公开 `workspace-controller.documentsDirectory` 将首次默认目录放入候选 `workspace/deepseek-harness`，版本化设置指纹确保已有开发 profile 也会更新。已登记项目路径保持原样。问题发现时尚未发送提示；旧合成 fixture 保留，后续使用全新目录复测，没有清理或修改真实 Documents 内容。实际 RPC 的重复初始化、重启后默认目录与显式项目路径保留，以及新原生首屏路径均通过。

源码配置更新保留同模型原生 reasoning effort；恢复历史时修复已从托管路由移除的模型。缓存策略按不可变凭据修订绑定，配置两次写入间隙不会误用上一修订策略；旧请求和回滚仍持有原策略。源 profile 接受原生插件管理器添加的合法 bundle 名称，基础 bundle 与非法路径继续拒绝。

证据：`source-protocol-models.json`（两协议模型/工具/四轮及重启）、`source-hot-policy-wire.json`、`source-task-snapshot-{openai,anthropic}.json`（真实 Rust 私有管道、首次请求前快照、封存/恢复、配额与撤销）、`source-profile-network.json`、`source-api-negative.json`、`source-offline-smoke.json`。快照报告明确标记 `nativeTauriWindow:false`，不冒充窗口验收。离线 smoke 使用最小 PATH 与本地 mock，首个嵌套执行沙箱尝试因 `EPERM realpath C:\\Users\\enxi1` 失败，正常本地权限复测通过，未放宽产品沙箱。实际 ZAI preset 切换与 13 提供方/105 模型检查通过，但直接内置路由测试不覆盖别名继承问题。

最新 Rust 全量 93 通过、1 专门集成测试默认忽略（已另行双协议通过）；adapter/profile/control/窗口权限合计 19 通过，旧 settings/cache bridge 和模型迁移回归通过。资格目录封存校验 28,218 文件，仍为 `productionAdmission:false`。开发 EXE `1e8360b3…43088` 的原生任务完成、工具结果、环境浮窗、快照导航与桌宠拖动已实际检查；受控重启后历史可打开、宠物位置保留、mock 请求数保持 5 次，正常退出后宿主与两次后端均已消失。见 `source-native-development.json`。标签仍为 0.2.4-rc.2，最终包必须重新编译验收。

剩余明确阻断：独立连接路由丢失固定内置目录的完整模型兼容字段。最小 `catalogProvider` 提案见 `proposals/M1-CATALOG-ROUTE.md`，等待新增 fork 接口的明确授权，尚未修改 fork。源码 pin 准入保持 false。完整构建/离线交付与最终原生验收尚未完成。

### S4a/S5b：源码完整协议与前缀回归（2026-09-24）

提供方热应用接入后重新执行完整双协议 wire：鉴权、工具、工程操作沙箱与取消、产物下载、缓存探测/策略、冷恢复不重放、诊断隐私和设置持久化均通过。原 38 项前缀检查全部通过，包含规则、skills、工具、history、重试、重启、手动压缩和权限变化；仅将原已移除的 preset 文件引用换为当前源码公开的声明式 preset。没有删减断言或修改上游。

实际 Git 变更审阅、首请求持久基线、草稿和鉴权检查通过。重复工作区检查确认新版 Cordis 隔离报错的 workspace 服务但继续启动 HTTP，旧版直接退出；断言分别保留对应事实，桌面修复后原始备份逐字节相同、会话及归档完整、再次启动无重复修复。证据：source-wire.json、source-prefix-wire.json、source-workspace-recovery.json。本阶段为 Harness/API 回归，最终 EXE 原生窗口仍待验收。

### S5a：提供方下一请求更新（2026-09-24）

同一进程网络配置下，已保存的连接使用独立路由与显示名同时出现在原生模型选择器。Tauri 根据实际运行网络配置判断热应用或重载；代理/CA 变化保留原任务检查流程。监督管道响应绑定进程 epoch、请求 ID 和 catalog revision。进行中的模型请求保持其快照，后续请求读取新配置；已有会话保留自身选择，默认模型设置用于未另行选择的会话。

发现上游 credentials-local 读取的是 launch environment 快照，运行中修改 process.env 不会更新凭据。桌面改为继承公开 LocalCredentialProvider 服务，对保留的主连接引用读取私有管道内存快照；Windows Credential Manager 仍为持久来源，普通 YAML 只存引用。其他引用/record 完全委托原生服务，识图本地凭据回归通过。没有新增 fork hook 或修改 node_modules。

双协议实测通过：同名模型的两个提供方、暂停旧请求期间修改 endpoint/key、同一工具循环后续请求采用新配置、PID 不变、旧诊断指纹不被迟到结果覆盖、空密钥/过期修订/无效模型拒绝、第二设置写入失败后的回滚、重启不重放、主密钥不写 YAML。见 evidence/0.2.5/source-provider-wire.json。Rust 同名连接路由隔离与网络重载边界 2 项、私有密钥/旧 epoch 拒绝、profile 8 项、模型默认值及诊断回归通过。该记录证明真实 Harness 管道与 Rust 编译/单测；最终原生窗口热应用仍待验收。

旧 hash 桥未改变。源码分支以已审查的 dad014b7 回执与实际构建模块 SHA256 验证公开 payload hook，走事件回调，不进行旧源码字符串重写。缓存中心改为跟随当前托管路由，诊断在每个请求创建时捕获配置指纹。

### S6a：源码 staging 强制终止恢复（2026-09-24）

发布事务持久记录完整新旧文件树指纹、精确目录和进程身份；恢复仅在独占锁可取得、原进程确认退出且树指纹吻合时运行。未知锁/旧版记录/外部修改不清理。原始 7 项失败回滚测试，以及真正终止子 PowerShell 的 5 项崩溃场景通过：移动前、两个 rename 间隙、提交完成后和树被外部修改。恢复不覆盖旧目录，失败候选保留，重复恢复无操作。

复核官方 ConfigEditor 发现其锁目标为 profile/package.json，已将桌面启动锁及精确死进程回收路径对齐，避免与原生设置写入采用不同锁。本项属于 S6 的 staging 子里程碑；完整构建与交付仍未完成。

### S3：合成旧资料迁移与回退验证（2026-09-24）

旧 settings.yaml 在自有 profile 锁下完整校验后写入加密事务，完成后才原样归档到 desktop-legacy-settings/settings.yaml。未知节/字段、明文主连接密钥、未知锁、上游部分导入状态明确拒绝，文件保留；启动页提供恢复说明。旧缓存扩展策略单独迁移到 payload hook 的配置，不向新官方 schema 塞入旧字段。导入保留原生提供方配置。

测试以实际旧 0.1.5 writer 创建压缩 v3 会话，复制两份后由新固定产物读取、续写 v4；只读打开不写盘、原 v3 字节不变、独立备份可恢复到旧引擎均通过。重复工作区跨连接合并、归档、附件、skills、规则文件保留；未知 v99 拒绝且字节不变。未使用或迁移真实用户资料。见 evidence/0.2.5/source-migration.json。

桌面 profile/data/workspace/错误分类定向 12 项通过；固定 Harness generation 与 migration-refusal 210 项通过（含崩溃遗留 staging、发布失败、取消及未知格式）。Rust 启动错误分类定向 1 项通过。本阶段不承诺旧 EXE 可回写新目录；降级必须使用迁移前完整副本。真实资料的手动候选导入仍须先复制项目并核对路径，当前不会自动挂载正式数据。

### S2：源码候选与设置适配（2026-09-24）

固定 `dad014b7` 源码产物已构建。候选通过自身 `dsh-desktop` profile 启动；设置写入使用加密事务和原生文件锁，主连接密钥保持凭据引用。默认正式环境拒绝该源码候选。旧 settings.yaml 暂时明确拒绝，待 S3 受控迁移；没有交给会提前重命名旧文件的上游导入器。

实际验证：adapter/profile 11 项、设置事务（含 Windows DPAPI）、主题、通知、恢复、工程操作、诊断单测通过；Rust HTTP 2 项和 release 编译通过。完整本地双协议 wire 回归通过，包含工具、工程操作沙箱、任务中断冷恢复、鉴权、隐私和设置持久化。识图双协议与缓存键/工具循环/重启/会话隔离定向回归通过，结果见本目录 evidence/0.2.5/source-*.json。

原生 Windows 开发候选实际完成首次启动、受控重启和正常退出，WebView2 为 153.0.4234.48。日志验证首次后端 38540、重启后 37384，退出后宿主 20740 和两后端均不存在。本次 EXE 仍显示 0.2.4-rc.2，不能当作最终 0.2.5 交付验收；完整功能窗口检查待最终产物。

发现并保留限制：固定上游 Windows ACL 沙箱在当前 D 盘开发目录授予写权限时返回 Win32 5；相同代码在用户临时目录通过，完整 wire 回归在那里执行，没有关闭沙箱或修改目录 ACL。上游 ACL 定向 12 项通过。后续交付必须说明目录权限要求。

适配了 session v4 顶层 tool/result、新版 shell.execute().result() 和 volatile 设置值；旧运行时路径保留。源码生产准入仍为 false，S3/S5/S6 尚未完成。

1. S2：固定来源产物、自有 profile、设置/凭据适配、首次隔离 Tauri 启停。
2. S3：合成旧资料复制迁移、未知格式拒绝、中断恢复及降级副本。
3. S4：恢复、通知、桌宠、工程操作、快照、主题、浮窗回归。
4. S5：提供方下一请求生效、网络重载范围、双协议最终请求及缓存前缀。
5. S6：staging 崩溃恢复、完整构建、原生验收与离线候选目录。

计划第二批中的故障恢复、本地首屏、插件管理和目录选择器随对应宿主适配验证。可选工作依赖包、签名证书和“有实际使用需求再做”的浏览器/语音不作为本次引擎适配前置条件。真实内网、手动锁屏/睡眠、混合 DPI、触控/笔、长期性能和干净企业镜像只有实际执行后才能记为 PASS。
