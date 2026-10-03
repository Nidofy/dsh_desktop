# DSHDesktop 独立技术评审报告
## Tauri 自研版 vs DeepSeek 官方 Electron 版：架构评价、功能差异与迁移可行性

- **评审日期**：2026-09-24
- **评审立场**：独立第三方 reviewer，与两个项目均无利益关系
- **评审对象**：
  - 本项目（下称 **Tauri 版**）：`dshWinUi`（github.com/Nidofy/dsh_desktop），版本 0.2.5-rc.1，引擎 pin 为 fork 提交 `5e2879f0478ba9336128312e715dee7a9f56c3db`（DSH 0.1.7-alpha.2）
  - 官方实现（下称 **官方版**）：deepseek-ai/deepseek-harness monorepo checkout（`.investigation/upstream`），`@deepseek-ai/dsh-desktop` 0.1.6-alpha.2（Electron ^44）
- **评审方法**：全量实读 Tauri 版 `src-tauri`（26 文件/9,820 行 Rust）、`runtime-src`（60 模块/约 4,200 行）、`shell-ui`（约 1,200 行）、`scripts`（1,442 行）、`tests`（约 3,500 行）、47 篇文档与 139 个证据文件；官方版 `apps/desktop`（主进程 41 个 TS 文件/3,859 行）、`apps/desktop-host`（330 行）、相关 packages。关键论断经双路交叉验证。文中 `文件:行号` 均为实际核对的引用。

---

## 0. 执行摘要

1. **Tauri 版**是一套「个人项目规模、准生产纪律」的 Windows-only 离线桌面外壳：安全威胁模型、进程生命周期工程、供应链完整性、证据文化均达到小团队生产级水准；但其功能面大量建立在官方未承诺的私有 API 之上，形成「冻结 pin + 全量重鉴权」的升级锁定，且无 CI、单人单机、跨平台能力为零。
2. **官方版**是一个高度克制的跨平台薄壳（壳本身不到 4k 行，一半以上代码在打包/更新/签名工程），升级经济学正确、平台工程完整；但凭据明文、无托盘驻留、无离线故事、强在线服务耦合，对本项目所在的内网/自定义连接场景几乎没有官方出口。
3. **两者是互补缺口的镜像**。本项目提前实现了官方的 "deferred answers"（凭据加固、桌面驻留、缓存可控面），官方拥有本项目最缺的（跨平台、签名、更新、上游同步）。
4. **核心建议**：若目标是「基于 Electron 的跨平台 DSH Desktop」，应**基于官方 Electron 版迁移本项目的有价值内容**，而不是把当前 Tauri 版重新用 Electron 包装——重包装路线的工作量是迁移路线的超集，且做完后仍背着升级税。迁移可行性高：本项目约 75–85% 的引擎侧代码本就写在官方 sanctioned 扩展点上。单人全量迁移约 2.5–3 个月，暂缓非核心项可压缩到 6–8 周达到日常可用。

---

## 1. 两个实现的架构事实

### 1.1 Tauri 版（0.2.5-rc.1）

**技术栈**：Tauri 2.11.5（Rust 1.97.1）+ WebView2 Fixed Version 153.0.4234.48 + 捆绑官方 Node 24.16.0。版本与哈希全部锁定在 `versions.json`。

**架构**（ADR-001 明确自我约束：「永不实现 agent、sessions、tools、workspace 或 chat UI」）：

```
DSHDesktop.exe (Rust/Tauri)
├─ shell 设置窗（本地 index.html，29 个窄命令 + 票证二次确认）
├─ main 主窗（引擎就绪后 WebviewUrl::External 加载引擎 HTTP UI，
│   on_navigation 钉死 origin，远程 UI 零 IPC；engine.rs:696-709）
├─ session-diagnostics 窗（限 /desktop-diagnostics 路径）
├─ pet 桌宠窗 ×N（透明窗口）
└─ 引擎监督（engine.rs）
    ├─ spawn：捆绑 node.exe --import host.mjs → 官方 dsh CLI web --port 0
    ├─ 三通道就绪：stdout 严格校验 + health API 契约 + transport 检查，90s 超时
    ├─ Windows Job Object (KILL_ON_JOB_CLOSE) 收杀，含孙进程集成测试
    ├─ 私有 stdin/stdout 管道（start{json}/stop/snapshot/desktop-control/source-providers）
    └─ 退出协议 stdin "stop" → 6s → kill；换代即弃泳道 + 快照排空闸
runtime/（捆绑运行时）
├─ dsh/node_modules（官方引擎生产依赖树，27,876 文件 SHA-256 清单）
└─ *.mjs（runtime-src 编译产物，--import 注入引擎进程）
```

**引擎侧注入**（`host.mjs` 为启动闸门）：stdin `start{json}` 放行后依次执行版本化 adapter 校验（`BOOT_ADAPTER_UNSUPPORTED` fail-fast）→ 额外 CA 验证 → 工作区迁移 → 缓存键桥 → settings 同步/源码 profile 准备。60 个模块以 cordis 插件形态挂载，通过公开的 `webServer.register` 前缀路由在 `/desktop-diagnostics/*` 下自持 8 类桌面页面。

### 1.2 官方 Electron 版（0.1.6-alpha.2）

**架构**（薄壳哲学）：

```
@deepseek-ai/dsh-desktop (Electron 主进程, 3,859 行 TS + 40 协作模块)
├─ spawn @deepseek-ai/dsh-desktop-host（330 行）
│   └─ 以 ELECTRON_RUN_AS_NODE=1 + --expose-internals 运行
│       stdio 第 4 路 Node IPC：ready / fatal / shutdown-complete / update-tasks
│       in-process runProfile 承载完整 harness（固定端口 19387）
│       就绪后回传 authenticatedUrl + collectIndexInjections()
├─ 自定义特权协议 dsh-app://（main.ts:70-80）
│   壳托管 web 前端静态文件 + API/WS 转发给引擎（附认证 cookie）
├─ IPC 面极小：DESKTOP_IPC 9 通道 + MANDATORY_IPC 3 通道，
│   全部 handler 校验 sender frame/origin（ipc.ts:71-78）
├─ 渲染进程 sandbox+contextIsolation+nodeIntegration:false（main.ts:134-140）
└─ 更新系统：electron-updater + COS feed + 任务排空交接 + 强制更新策略
    + NSIS 差量 + mac 双通道公证 + win EV 签名
```

平台目标仅 mac-arm64/mac-x64 + win-x64（`main.ts:735` 明确拒绝其他组合）；README 明言 Linux 不是支持的发布目标。

---

## 2. Tauri 版评价

### 2.1 规模与流程基线（实测）

| 指标 | 数值 |
|---|---|
| Git 历史 | 21 次提交，唯一作者，2026-09-20 至 09-24（5 天） |
| Rust 壳 | 26 文件 / 9,820 行（94 个 `#[test]`） |
| runtime-src | 60 模块 / 约 4,200 行 |
| shell-ui | 28 文件 / 约 1,200 行（无框架原生 JS） |
| tests | 约 70 文件 / 3,500–3,850 行 |
| 证据存证 | docs 全树 241 文件，其中 evidence JSON 139 个 |
| 验收状态 | 完整构建 Gate 319 项 PASS、最终 EXE 原生验收 PASS；`realProviderRequests: 0`、`fieldAcceptance: NOT_TESTED`（诚实标注） |

### 2.2 突出优点

1. **安全威胁模型一以贯之**：远程 UI 零 IPC（capabilities 无 remote 段）、危险操作双票证（绑定 id+pid+epoch+revision+60s）、凭据分通道且互不落盘（凭据管理器 + `apiKeyEnv` 环境变量 + 私有 stdin 管道，YAML 只存引用，测试断言 key 不落任何 JSON）、stderr 只记条数不留内容。
2. **进程生命周期工程化**：三通道就绪判定（含对抗用例测试）、Job Object 收杀（真实孙进程测试）、按代隔离的 HTTP/快照泳道「换代即弃」、退出协议分级升级。
3. **供应链完整性工程达到商业水准**：三层逐文件 SHA-256 清单（dsh-integrity 27,876 文件 / runtime-integrity 28,218 文件 / package-integrity）、构建回执绑定输入输出、离线 ZIP 原子发布、包内 `Verify-DSHDesktop.ps1`。
4. **对耦合的诚实与治理**：`HARNESS_ADAPTER.md` 逐项分级披露全部私有耦合；`harness-adapter.mjs` 版本化准入把升级失配变成启动期固定错误码。
5. **证据文化**：失败与未测项如实留档（`additionalSdkFeedbackSnapshot: FAIL`、D 盘 ACL `NOT_ACCEPTED.txt` 均封存）。

### 2.3 突出风险/缺点

1. **结构性锁定（最大风险）**：功能面建立在官方未承诺的私有 API 上——`dsh-llm-pi-ai` 的 SHA256+双文本锚点内存源码改写（`desktop-cache-key-bridge.mjs:35-43`）、上游私有 DOM 属性的 ResizeObserver 布局手术（`desktop-environment/client.js:91-98`）、`app:web-surface` 精确英文句子（`desktop-prompt-stability.mjs:5-17`）、session writer 版本、私有管道协议。官方任何重构都可能静默破坏，解锁新版本需全量重鉴权——**越成功越难升级**，安全补丁吸收系统性滞后。
2. **跨平台能力为零**：约 3,300 行 NTFS 防御层（命名流检查、句柄 pin、重解析点防护）+ Job Object + 凭据管理器 + WebView2 管理，在 POSIX 上无对应物。
3. **工程流程单点**：无 CI、单人单机、56 步门禁链无快速反馈、版本号硬编码散落多处（`HARNESS_UPGRADE.md:31` 自认）、错误分类依赖中文子串匹配（`engine.rs:267`）。
4. **代码质量债**：`task_snapshots.rs` 2,565 行巨型单文件、`run()` 单函数约 370 行手写状态机、supervisor 多把 Mutex 加锁顺序仅靠注释约束（`engine.rs:336-337`）、双引擎格式并行维护、极端单行压缩风格 + 裸 `catch{}`（可诊断性被主动牺牲）。
5. 未签名、无自动更新（离线定位下的有意取舍，但构成企业落地摩擦）。

---

## 3. 官方 Electron 版评价

### 3.1 规模与定位

apps/desktop 合计 212 个源文件约 22,487 行：**src 仅 3,859 行**、tests 9,206 行（2.4 倍于 src）、打包/更新/签名脚本约 5,744 行、desktop-host 另计 330 行。壳的克制程度极高：无托盘、无多窗口、无独立设置页、无插件管理 IPC；插件/settings/客户端 UI 全部复用 Web 端。官方立场：shell 与 dsh 同版本强制一致发布（`package-target.ts:125-129`），扩展一律走插件而非改壳。

### 3.2 突出优点

1. **最难啃的平台工程已完成且被上游持续维护**：mac Developer ID + hardenedRuntime + @electron/notarize 双通道并行公证；win-x64 EV 签名（SafeNet USB token + 预检 + interlock）；NSIS 差量更新。
2. **更新系统完整**：electron-updater + generic feed（`download.deepseek.com/dsh-desk/feeds/`）+ autoDownload=false + 安装前任务排空交接（inspect/lock/unlock，`host-process.ts:169-186`）+ 失败回滚重启旧宿主 + 强制更新策略 + 更新日志（update journal）。
3. **升级经济学正确**：壳与引擎同仓发布，引擎 API churn（官方明示 pre-stable）由同仓 CI（100% 覆盖率 gate、doc-sync、snapshot 测试）先暴露——外部 pin 策略最痛的「升级税」在上游被制度性摊薄。
4. **安全配置规范**：sandbox/contextIsolation、12 个 IPC 通道全部 sender 校验、外链 shell.openExternal、WS cookie 仅主窗口且限 `dsh-app://app` origin、路径穿越防护、宿主 stderr 截断防凭据泄漏。

### 3.3 突出弱点（恰为本项目强项区）

1. **凭据明文 YAML**（`$DSH_HOME/.credentials.yaml`），Windows 下无 DPAPI/keychain/文件 mode 校验——官方 README 自认 OS-keychain provider 是 "deferred answer"。
2. **无托盘/关窗驻留**（window-all-closed 非 darwin 即退出，`main.ts:696-698`）；**无离线便携**（更新与强制更新轮询强绑 deepseek.com，无内网镜像/离线 feed/禁用开关；policy 初次失败 fail-open，一旦 40005 持续阻断）。
3. 无任务通知（client 侧无 Notification API 使用）、无任务快照/存储配额/环境隔离/迁移治理、无缓存配置入口与观测、无识图 provider。
4. Windows 仅 x64 无 arm64；无 Linux（dev 路径亦只认 mac/win，`main.ts:252`）；引擎端口固定 19387 仅 patch 可改。
5. 壳与引擎强绑同版本，任何引擎修复需整壳发版；渲染层无 dev server 热更。

---

## 4. 逐维度对比

| 维度 | Tauri 版 | 官方 Electron 版 | 优势方 |
|---|---|---|---|
| 平台覆盖 | 仅 Windows x64 | mac arm64/x64 + win x64 | 官方 |
| 壳设计哲学 | 厚壳（~15,000 行自有代码） | 薄壳（~4,200 行） | 官方（可维护性） |
| 凭据安全 | 凭据管理器+DPAPI+私有管道 | 明文 YAML | **Tauri 版** |
| 离线/便携 | 核心设计目标，三层完整性清单 | 无，强在线更新+强制轮询 | **Tauri 版** |
| 更新/签名/公证 | 无 | 完整且持续维护 | 官方 |
| 引擎升级路径 | 冻结 pin+全量重鉴权 | 同仓发布，上游摊薄 | 官方 |
| 桌面功能面 | 托盘/通知/快照/配额/缓存/自检/桌宠/迁移 | 刻意最少化 | **Tauri 版** |
| 工程协作 | 无 CI、单人、证据自证 | monorepo CI、多人、100% 覆盖 gate | 官方 |
| 对引擎私有 API 耦合 | 深（含内存源码改写） | 浅（同仓 churn 由 CI 先暴露） | 官方 |
| 内网/自定义连接场景 | 完整支持（多连接/代理/CA/自定义提供方/热应用） | 几乎无官方出口 | **Tauri 版** |

---

## 5. 专项：缓存命中相关改进（相对官方版）

### 5.1 官方基线（两边共用同一引擎）

- 引擎 pi-ai 适配器原生有 `cacheRetention: none|short|long`（`llm-pi-ai/src/config.ts:336`），但**官方任何 UI 均未暴露**（packages/client grep 零命中），仅能手写 profile 配置。
- OpenAI Completions 路径 `prompt_cache_key` 原生逻辑（实读捆绑 pi-ai `dist/api/openai-completions.js:585-592`）：

  ```js
  prompt_cache_key: (model.baseUrl.includes("api.openai.com") && cacheRetention !== "none") ||
      (cacheRetention === "long" && compat.supportsLongCacheRetention)
      ? clampOpenAIPromptCacheKey(options?.sessionId) : undefined
  ```

  即：**仅 api.openai.com 或显式 long 保留才发键；键值是裸 sessionId（截 64 字符）**。对自定义端点/内网网关/DeepSeek 本家 API，原生根本不发键，且发键时会话 ID 明文出网。
- Anthropic 路径有原生 `cache_control` 标记（long → `ttl=1h`）；usage 的 cacheRead/cacheWrite 进 Web UI 用量显示。
- **官方 Electron 壳层零缓存功能**：apps 全目录 57 处 "cache" 命中全是 CDN/更新器/浏览器缓存；无配置 UI、无键管理、无探针、无请求级前缀稳定性回归。官方桌面固定 19387 端口，重启不改系统提示——前缀稳定是架构副产品而非缓存设计。

### 5.2 本项目增量（均经双协议 wire 回归）

| # | 增量 | 内容与证据 |
|---|---|---|
| 1 | **会话级 HMAC 缓存键** | 为任意端点生成 `dsh_` 前缀 HMAC-SHA256 键（47 字符 ≤64 限制），scope=[桥版本, home, provider, 协议, baseURL, 模型, sessionId]，32 字节持久密钥签名——不可逆、不含会话明文/路径/内容；同会话工具循环/重试/重启复用；无会话身份不发键不退化全局键（`desktop-cache-key.mjs:10-29`）。实现已从 0.1.5 的锚点内存改写收敛为 fork 上已授权的 `llm-pi-ai/prepare-payload` 事件钩子（`source-cache.mjs:10-18`），onPayload 只增删 `prompt_cache_key` 一个字段、保留原生 cache 标记 |
| 2 | **缓存请求策略 UI** | 原生默认/自动/长期（OpenAI `prompt_cache_retention=24h`、Anthropic `ttl=1h`）/OpenAI 格式 Anthropic 标记 × 键三模式（原生兼容/关闭/按会话），逐模型勾选确认（`CACHE_CENTER.md:5-18`） |
| 3 | **缓存探针** | 4/6 请求 A/B 合成探针，走真实适配器/凭据/代理/序列化路径，判定上限 `ADAPTER_REPORTED_CACHE_READ`/`INCONCLUSIVE`，每连接 30 份历史+预算控制+脱敏导出（`CACHE_CENTER.md:37-47`） |
| 4 | **能力声明+配置指纹** | 按模型 supported/unsupported 声明绑定连接/凭据/代理 HMAC 指纹，漂移即过期；声明与探针结果分开记录 |
| 5 | **前缀稳定性回归门禁** | 38 项×双协议构建门禁（`EXPECTED_APPEND/IDENTICAL/CACHE_BREAK`），覆盖重试字节一致、工具增删、Skill、压缩、模型切换、重启（`PREFIX_REGRESSION.md:7-14`）；官方无同类请求级回归 |
| 6 | **重启前缀断裂修复** | 随机端口会改写系统提示中的 web surface URL → 已通过 `system-prompt/assemble` 扩展修复（地址进持久 runtime-context snapshot）；官方以固定端口规避同一问题，桌面方案额外保留端口冲突韧性 |
| 7 | 热更新安全 | 缓存策略按不可变凭据修订绑定，热应用/回滚期间进行中请求持有原策略不串键（IMPLEMENTATION-0.2.5 S5） |

### 5.3 诚实边界

- **命中本身没有被声称提升**：键/标记只是路由与保留提示，命中由服务端决定；`realProviderRequests: 0`、真实命中率 NOT_TESTED、「参数被接受、耗时降低都不能单独证明缓存已生效」（`CACHE_CENTER.md:18`）。
- 探针判定上限为适配器自报计数，原始 provider 计数恒标 `UNKNOWN`。
- 准确表述：**在「请求可控面」（键策略、标记、前缀稳定性、可观测性）上有明确且经回归的增量；在「命中结果」上没有也不能声称提升。** 其中第 1、3、6 项是官方完全没有的能力。

---

## 6. 功能差异详细清单

### 6.1 官方有、本项目没有（缺口，9 项）

| 能力 | 官方实现要点 |
|---|---|
| 自动更新 | electron-updater + staged 安装 + 任务排空交接 + 失败回滚 + NSIS 差量 |
| 强制更新策略 | 轮询 harness.deepseek.com，40005 阻断（fail-open 初检） |
| macOS 支持 | 公证、dock bounce、vibrancy、hiddenInset |
| Windows EV 签名 | signtool /kc /csp + 硬件 token 预检 |
| i18n | desktop locale 解析、菜单/对话框本地化 |
| Office 主运行时 | 捆绑 Python/LibreOffice，desktop-office 插件 staged 安装 |
| 原生目录选择器 | `directory-picker.ts`（in-page + native 双模式） |
| 致命错误恢复 | 原生恢复对话框（`fatal-recovery.ts`） |
| 渲染层 HMR | 插件热替换机制 |

### 6.2 本项目有、官方没有（增量，23 项）

**A. 壳层（5 项）**

| # | 功能 | 官方对应物 |
|---|---|---|
| A1 | 托盘 + 关闭到托盘驻留（后台任务继续） | 无 |
| A2 | 任务系统通知（完成/失败/等待确认/等待输入，点击定位会话，前台抑制） | 仅更新提醒 flash/dock bounce |
| A3 | 桌宠（3 实例、资源导入导出、独立外观） | 无 |
| A4 | 独立本地设置窗口（跟随 DSH 明暗/字号 tokens） | 无（全走 Web UI） |
| A5 | 桌面页面多窗（8 类页面独立窗口） | 仅主窗 |

**B. 宿主/承载层（6 项）**

| # | 功能 | 官方对应物 |
|---|---|---|
| B1 | 引擎监督强化（三通道就绪/health 契约/版本白名单/重启票证/快照排空闸/Job Object/错误码映射） | host IPC + 更新 drain；无健康契约与票证 |
| B2 | 凭据管理器 + DPAPI 事务 + 凭据清理（引用集/宽限期/TOCTOU），主密钥私有管道 | 明文 YAML（官方自认 deferred） |
| B3 | 多连接 profile + 提供方下一请求热应用（同名模型按连接区分、不可变凭据修订） | 无连接管理器、无热应用 |
| B4 | 候选环境隔离（stable/candidate 数据隔离、降级边界） | 无（单 profile） |
| B5 | 离线便携交付（固定 Node+WebView2、三层清单、Verify、离线 ZIP） | 在线模型，无便携目标 |
| B6 | 源码构建准入（fork pin、逐文件清单、BOOT_ADAPTER_UNSUPPORTED） | 不需要（同仓发布） |

**C. 引擎侧注入功能（12 项）**

| # | 功能 | 官方对应物 |
|---|---|---|
| C1 | 任务快照（工作区文件级、每轮自动 pre-step 等待链、start/end 契约、冲突检查恢复、配额、NTFS 防御层） | 仅会话归档 + workspace-changes，无文件级快照/恢复 |
| C2 | 任务状态与恢复页（事件投影、冷恢复不重放） | web 有会话历史（引擎级）；恢复页为增强视图，部分重叠 |
| C3 | 项目操作（构建/测试命令、信任指纹、日志、产物） | 有 terminal sidebar/jobs；无工程命令信任配置，部分重叠 |
| C4 | 变更查看增强（分支搜索/切换/创建、提交暂存、确认后推送、Hg、任务前后基线、草稿） | workspace-changes 提供变更显示 |
| C5 | 环境浮窗（slots 注入：变更/分支/环境/来源） | 无 |
| C6 | 缓存子系统（键/策略 UI/探针/声明/前缀回归/重启修复，见 §5） | 引擎参数存在，壳与 UI 零功能 |
| C7 | 识图插件（独立 Base URL/模型/凭据、双协议） | 无（`/vision` 命令仅为测试 fixture） |
| C8 | 诊断中心 + A/B 比较 + 自检中心 | 无 |
| C9 | 存储配额预留（storage admission） | 无 |
| C10 | 设置事务（DPAPI 日志事务、roll-forward、文件锁） | 无桌面级写入事务 |
| C11 | 桌面级工作区迁移（v2→v4 复制式、未知格式拒绝） | session format 迁移引擎内已有；桌面级标记/拒绝为增量 |
| C12 | `prepare-payload` hook + `catalogProvider` 接口（fork 已授权提交） | 无此接口 |

---

## 7. 迁移成本与可行性分析

> 目标：在官方 Electron 版之上获得跨平台桌面，同时保留本项目增量。

### 7.1 官方桌面容纳桌面功能的四个落点（已逐一核实）

1. **引擎侧 cordis 插件**：官方 desktop-host 用 `loadProfileDirectory` 加载 profile 目录 + `ctx.plugin()` 装插件（`desktop-host/src/index.ts:17-36`），官方插件管理器支持向 desktop profile 添加 bundle。本项目 runtime-src 模块大多已是 `apply(ctx, config)` 形态，**不需要 `--import` 预载技巧**。
2. **Client UI 插件**：两边同一套 web 前端与 `window.__ModuleLoader__`/slots，`desktop-client`/`desktop-environment` 两个 bundle 原样可用。
3. **壳层 Electron 主进程**：对 `apps/desktop` 做薄 fork（或上游贡献）。
4. **需要新引擎接口**：仅 fork 的两个 hook（C12）。

### 7.2 分级总表

成本：低 ≈ 数天；中 ≈ 1–2 周；高 ≈ 3–4 周（单人含测试）。可行性：✅ 直接迁移 / 🟡 需薄 fork 或部分重写 / 🔴 依赖上游接受 / ⛔ 建议降级或放弃。

| 项 | 迁移落点 | 关键依赖 | 成本 | 可行性 |
|---|---|---|---|---|
| C6 缓存-探针/中心/声明/回归 | 引擎插件+页面 | 公开 `webServer.register`/`SettingsForms` | 低 | ✅ |
| C6 缓存-会话键 | 引擎插件 | **`prepare-payload` fork hook** | 迁移低/上游化中 | 🔴 推上游 PR |
| C8 诊断/A-B/自检、C2 恢复页、A5 多窗 | 引擎插件+页面 | 同上 | 低 | ✅ |
| C3 项目操作、C4 变更查看 | 引擎插件 | `defineTool`/shell 沙箱（公开） | 低-中 | ✅（建议与官方 workspace-changes 对齐） |
| C5 环境浮窗 | client 插件 | slots/DOM 私有名（两边同前端，风险一致） | 低 | ✅（标记脆弱点） |
| C7 识图、C9 配额、C10 设置事务、C11 迁移 | 引擎插件 | credentials-local/Node fs；DPAPI→safeStorage | 低-中 | ✅ |
| B2 凭据管理器+管道 | 壳 safeStorage/koffi + 引擎 `LocalCredentialProvider` 扩展（已是插件代码） | koffi 已在官方 profile `allowBuilds`（`project-manager.ts:50`） | 中 | ✅ **且是官方 deferred answer 的贡献点** |
| C12 catalogProvider | fork 接口 | 上游接受 | — | 🔴 决定 B3 命运 |
| B3 多连接热应用 | 壳+引擎插件 | 私有管道 + 两个 hook | 中-高 | 🔴 接口被拒则降级为「切换需重启」 |
| A1 托盘、A2 通知、A4 设置窗 | Electron Tray/Notification/preload | 无 | 低-中 | 🟡 薄 fork |
| A3 桌宠 | Electron 透明窗（现有 pet UI 为 web 技术） | pet-state 引擎插件直接迁移 | 中 | 🟡 建议排最后 |
| B1 监督强化、B4 环境隔离 | desktop-host 增强（330 行小文件）/Electron 多实例 | 无 | 中 | 🟡 |
| B5 离线便携 | 打包脚本薄 fork：portable 目标 + 禁用更新轮询与强制策略 + 清单并入 `desktop-runtime.json` | Electron 自带运行时 | 中 | 🟡 **固定 Node/WebView2 工作整体消失（净收益）** |
| C1 任务快照 | 策略层=引擎插件（`agent/pre-step` 公开等待链，直接迁移）；文件防御层 2,565 行 Rust 需 Node 重写或降级 | — | 高 | 🟡 先迁策略层+fs 级恢复（约 1 周）；NTFS 防御降级或 koffi 直调 |
| B6 源码准入、旧锚点改写桥、重启前缀修复 | — | 官方同版本发布/固定端口后失效 | — | ⛔ 放弃 |

### 7.3 量化汇总

| 资产 | 迁移判定 |
|---|---|
| runtime-src（~4,200 行） | **约 75–85% 可原样或近原样迁移**（本就写在官方 sanctioned 扩展点上） |
| src-tauri（9,820 行） | 约 60% 由 Electron/官方机制**替代消失**（监督/WebView2/Node 管理/单实例/票证等 commodity）；约 25% 需 TS 重写（凭据/环境/配额桥）；约 15%（快照 NTFS 防御层）降级或 koffi 重写 |
| shell-ui（~1,200 行） | 换桥即用；长期建议并入官方 Web 设置 slots |
| tests（~3,500 行） | wire/prefix/迁移回归为引擎侧测试，**直接复用**——迁移中最被低估的资产，为每项迁移提供现成门禁 |
| 流程资产 | versions pin 纪律、完整性清单、证据门禁 → 合并进官方 `desktop-runtime.json` 与打包流程 |

### 7.4 为什么不选「重新包装」（路线 A）

- 重包装 = 保留 runtime-src + shell-ui + 测试方法论（这些在路线 B 中**同样保留**），报废重写全部 9,820 行 Rust + 打包链，且失去官方更新/签名/上游同步资产。**A 的工作量是 B 的超集，净收益为负。**
- A 做完后仍背着「冻结 pin + 全量重鉴权」升级税；B 把升级税交给上游制度性摊薄。
- B 的唯一前置是接受跟随官方 alpha 的 API churn——而本项目发明的 adapter 准入 + 固定错误码 + 回归门禁，正是管理这种 churn 的现成工具。

### 7.5 建议路径

| Phase | 内容 | 估算 |
|---|---|---|
| 1 | runtime-src 打包为 desktop profile 插件 + /desktop-diagnostics 页面在官方 desktop-host 跑通；wire/prefix 回归绿 | 2–3 周 |
| 2 | 壳层：托盘/通知/设置窗/凭据管理器（safeStorage+koffi） | 3–4 周 |
| 3 | 快照策略层迁移 + fs 级恢复；离线便携打包目标（含禁用强制更新） | 2–3 周 |
| 4 | 上游 PR：`prepare-payload`、`catalogProvider`（成败决定多连接热应用最终形态） | 1–2 周 + 社区周期 |

单人全量约 **2.5–3 个月**；暂缓桌宠与快照防御层可压缩至 **6–8 周**达到日常可用。Tauri 版在过渡期继续作为 Windows 基准交付，Electron 版通过同等严格度验收 Gate 后切换。

---

## 8. 最终结论

1. **Tauri 版的价值排序**：流程资产（回归套件、准入机制、证据门禁）≥ 引擎侧功能模块（runtime-src）> 安全与凭据工程 > shell-ui > Rust 壳本体。迁移时应按此顺序取舍。
2. **迁移可行性高**：增量功能绝大多数落在官方 sanctioned 扩展点；真正的结构不确定点只有三个——①上游是否接受两个 fork hook（有降级路径）；②快照 NTFS 防御层接受降级（fs 级保证覆盖绝大多数场景）；③强制更新/在线轮询必须随便携目标一起 fork 掉（含 fail-open→40005 阻断细节）。
3. **缓存专项**：本项目的键策略（覆盖自定义端点+隐私安全化）、探针、策略 UI、前缀回归、重启断裂修复是官方完全没有的能力；但「命中率提升」未做真实服务端验证，不做声称。
4. **长期归宿**：`prepare-payload` 与 `catalogProvider` 应推上游——这既解除本项目最大的分叉负担，也是对官方的真实贡献（请求钩子属于 llm seam，catalog 继承属于 catalog 路由，均有上游价值）。

---

## 附录 A：不确定与未验证项（诚实声明）

- 「远程 UI 零 IPC」基于 Tauri 2 capability 配置与默认 ACL 推断，未做运行时验证。
- 官方版结论基于 0.1.6-alpha.2 源码；本项目 pin 为 0.1.7-alpha.2（差一个版本），方向性结论不受影响。
- 迁移成本为单人估算区间，未含官方 API churn 造成的返工；Phase 4 依赖社区评审周期，不可控。
- 本项目多连接热应用、快照策略层等在 0.2.5-rc.1 的原生 EXE 验收已通过，但真实内网/企业镜像 field acceptance 全部 NOT_TESTED——迁移后这些现场验收义务不会消失。
- 桌宠、环境浮窗等 UI 功能的迁移必要性未经产品验证，成本估算假定「按现状平移」。

## 附录 B：关键文件索引

| 主题 | 文件 |
|---|---|
| 本项目架构决策 | `docs/ADR-001-DESKTOP-ARCHITECTURE.md` |
| 私有耦合披露 | `docs/HARNESS_ADAPTER.md` |
| fork 与源码构建 | `docs/HARNESS_SOURCE.md`、`docs/HARNESS_UPGRADE.md` |
| 缓存子系统 | `docs/CACHE_CENTER.md`、`docs/PREFIX_REGRESSION.md`、`runtime-src/desktop-cache-key.mjs`、`runtime-src/source-cache.mjs` |
| 快照契约 | `docs/TASK_SNAPSHOTS.md`、`src-tauri/src/task_snapshots.rs` |
| 通知契约 | `docs/NOTIFICATIONS.md`、`src-tauri/src/notifications.rs` |
| 验收状态 | `MVP_STATUS.json`、`BLOCKER_REPORT.md`、`docs/IMPLEMENTATION-0.2.5.md` |
| 官方壳 | `.investigation/upstream/apps/desktop/src/main.ts`、`host-process.ts`、`ipc.ts` |
| 官方宿主 | `.investigation/upstream/apps/desktop-host/src/index.ts` |
| 官方凭据基线 | `.investigation/upstream/packages/credentials/credentials-local/README.md` |
