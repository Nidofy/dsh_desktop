# Relay37 UI review 逐项处置（最终）

本表记录三份用户审查的全部 105 个编号，实现及单一 p37f 交付已完成；每项分别标明源码、自动回归、实际界面或明确未覆盖的验证边界。源报告保持原字节；不采用其伪 API、未经验证的性能结论或扩大权限的建议。

证据根：`electron/.build/dispatch/evidence/relay-37`。已通过批次：`ui-first-complete-1791872260552` 502 项；`credentials-complete-1791873157105` 336 项；窗口 20+17 项；identity JSONL replay 2 项；管理页先行 10 文件通过及 `management-behavior-1791874459227` 13 项；pet/loader `pet-loader-cleanup-1791874982753` 10 项；通知/取消 `notices-and-cancel-ui-1791876336442` 42 项；通知 v2/统计 `notification-v2-coverage-1791876558854` 9 项；独立笔记本 `notebook-standalone-1791877124117` 1 项。首轮失败和修复前日志保留，不视作通过。

| 编号 | 当前处置 | 事实与边界 | 主实现或验证（electron 相对路径） |
|---|---|---|---|
| ISSUE-01 | 核实为夸大；布局细化已改 | shell-center 的 1040px 阈值已排除两侧栏；保留 shell.accessory，缩减 dock 间距；p37f 稳定动画后中文窄屏目视通过。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| ISSUE-02 | 已改 | 伴随栏/笔记本使用可读摘要与折叠详情；Host 页保留高级 JSON 与业务错误详情，不声称全部结构化。 | packages/nidofy/desktop-extras/src/client/EnvironmentExplorer.tsx |
| ISSUE-03 | 误判部分；样式已改 | 壁纸仅伪元素 opacity，未降低正文透明度；语义色/边框/间距统一，p37f 伴随栏及管理页亮暗主题目视通过。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| ISSUE-04 | 已改并测 | 笔记本分为当前笔记、编辑器与折叠高级/上下文设置；独立 Settings 入口已验证。 | packages/nidofy/working-notebook/src/client/NotebookPanel.tsx |
| ISSUE-05 | 已改 | Notebook 样式限于独立 owner，移除跨包重复主规则；不是全部样式 100% 重复。 | packages/nidofy/working-notebook/src/client/style.ts |
| ISSUE-06 | 已改并测 | 空实例/失败退避、按变化 IPC/尺寸；主窗隐藏不暂停独立桌宠。 | apps/desktop/tests/pet-lifecycle.spec.ts |
| ISSUE-07 | 原已有控制；补生命周期 | Environment visibilitychange + IntersectionObserver 已控制动画；新增 SDK 引导取消/清理，不声称原来完全无节流。 | packages/nidofy/desktop-extras/tests/offline-script.client.spec.ts |
| ISSUE-08 | 部分误判；保留现有键盘设计 | 只有 application/edit 两项；已有 Tab、左右箭头与向下打开及编辑选区恢复，不另增可能冲突的全局 Alt 拦截。 | apps/desktop/src/preload-menu.ts |
| ISSUE-09 | 已改 | 伴随导航复用官方图标；文本事实标记与图标分别处理。 | packages/nidofy/desktop-extras/src/client/EnvironmentIcon.tsx |
| ISSUE-10 | 已改并测 | 历史时间采用应用 locale，测试固定时区；列表保留分页与范围。 | packages/nidofy/desktop-extras/src/client/AnalysisHistory.tsx |
| GLM-UI-001 | 已改并测 | 侧栏展开/折叠均显示全局连接状态与重连入口。 | packages/client/ui-settings-general/src/client/SettingsRoot.tsx |
| GLM-UI-002 | 已改并测 | Markdown 代码块限制为60vh/36rem内滚动，完整DOM与复制保留；流式代码回归通过。现有分页/锚点不变，不无证据全量虚拟化。 | packages/client/ui-chat/src/client |
| GLM-UI-003 | 已改并测 | 树行键盘导航与激活，保留 IME/嵌套控件守卫。 | packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx |
| GLM-UI-004 | 已改并测 | 破坏操作显式默认取消对话框，保留原权限/预览。 | packages/nidofy/desktop-extras/src/management-ui.ts |
| GLM-UI-005 | 已改并测 | 持久化 bounds/maximized，验证并钳制工作区。 | apps/desktop/src/window-state.ts |
| GLM-UI-006 | 源码、单元与实际组装通过 | 实际 p37f 假密钥 Esc/Close/切 General 的 Keep 和切 General 的 Discard 均通过；不引入 Electron 静默 beforeunload。 | packages/client/ui-settings-general/src/client/SettingsRoot.tsx |
| GLM-UI-007 | 已改并测 | credentialError 可见且可重试。 | packages/client/ui-settings-models/src/client/ModelsSection.tsx |
| GLM-UI-008 | 已改并测 | 欢迎窗 nativeTheme 标题符号色跟随并清理监听。 | apps/desktop/src/welcome-window.ts |
| GLM-UI-009 | 已改并测；代表页实机通过 | Host 管理页共用 theme/confirm；实际 Connections 亮暗及完整URL复用通过，未声称每页所有动作实测。 | packages/nidofy/desktop-extras/src/management-ui.ts |
| GLM-UI-010 | 已改并测 | 退出默认取消。 | apps/desktop/src/quit-confirmation.ts |
| GLM-UI-011 | 已改并测 | scale 仅接受四个有限合法值。 | apps/desktop/tests/pet-lifecycle.spec.ts |
| GLM-UI-012 | 已改 | 页脚移除陈旧版本；诊断使用当前包 package.json 的 extensionVersion，不冒充Host版本。 | packages/nidofy/desktop-extras/src/ui.ts |
| GLM-UI-013 | 清理完成；保留终端交互 | 移除未生效的注释注册块，保留xterm选区复制与显式重连，不恢复会自动挂载终端的旧路径。 | packages/client/ui-sidebar-terminal |
| GLM-UI-014 | 已改 | 显示已有自动刷新开关，沿用原refresh owner与权限。 | packages/client/ui-sidebar-files |
| GLM-UI-015 | 已改并测；实机缩放未覆盖 | preload 标题栏高度按 zoom 更新，实际 Windows zoom 标题栏未额外操作。 | apps/desktop/src/preload-app.ts |
| GLM-UI-016 | 已改并测 | 根与entry失败显示locale-owned说明及仅重载界面的入口；保留日志/隔离/真实装配失败语义。 | packages/client/ui-renderer/src/client/scoped-slots.tsx |
| GLM-UI-017 | 已改并测 | 后台关闭提示增加默认取消。 | apps/desktop/src/background-notice.ts |
| GLM-UI-018 | 已改 | 不可路由选择显示警告与说明，保留用户选择，不自动换模型。 | packages/client/ui-model-selection/src/client/ModelSelect.tsx |
| GLM-UI-019 | 已改并测 | 引导尺寸根据屏幕工作区钳制。 | apps/desktop/src/window-state.ts |
| GLM-UI-020 | 现值一致 | 当前welcome caption CSS与原生overlay均为40；根padding为外层盒，不将其误认为42px caption。 | apps/desktop/renderer/welcome.css |
| DS-UI-001 | 已改并测 | 可选 providerIdentity 用于选择比较；raw revision 仍用于请求/重试/日志；触发条件不是所有托管请求。 | packages/api/session-controller/tests/provider-identity-replay.host.spec.ts |
| DS-UI-002 | 已改 | 共享独立文档theme/confirm；两语言脚本解析与行为测试验证这些Host页，不声称其属于TSX扫描。 | packages/nidofy/desktop-extras/src/management-ui.ts |
| DS-UI-003 | 已改并测 | 缓存私有 scope 使用稳定连接+凭据分区；通用 hooks 保留 raw provider；仅限定 OpenAI session 缓存策略，不保证服务端命中。 | packages/nidofy/desktop-extras/tests/cache-routing.spec.ts |
| DS-UI-004 | 已改并测 | 输入草稿进入按连接/会话隔离 store；晚到保存不清后来输入；scope 结果不复用授权。 | packages/nidofy/working-notebook/src/client/drafts.ts |
| DS-UI-005 | 已改 | 自检返回extras自检页，比较返回workbench builds；完整URL复用不变。 | apps/desktop-host/src/selftest/ui.ts |
| DS-UI-006 | 已改并测 | 观察 registry 的后台 job 终态，过滤 awaited/teardown/internal/subagent，opt-in；进程死前未记录的终态无法事后重建。 | apps/desktop-host/src/workbench/owner.ts |
| DS-UI-007 | 已改并测 | canCancel来自当前活动owner；完成/冷读禁用，owner端仍验证取消归属。 | apps/desktop-host/src/experiments/task-ui.ts |
| DS-UI-008 | 已改并测 | 通知共享 terminalStatus，保留 blocked/limit/interrupted。 | apps/desktop-host/tests/notifications.spec.ts |
| DS-UI-009 | 已改并测 | 搜索失败独立错误+重试，不冒充空结果。 | packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx |
| DS-UI-010 | 已改 | 高级设置说明reasoning在composer逐模型选择，不新增不受支持默认字段。 | apps/desktop-host/src/connections/ui.ts |
| DS-UI-011 | 已改并测 | pending 消费与 cold JSONL replay 使用已记录 identity；旧字段缺失不猜历史。 | packages/api/session-controller/tests/provider-identity-replay.host.spec.ts |
| DS-UI-012 | 已改并测；代表页实机通过 | 所有管理页共享亮暗 CSS；实际 Connections 亮暗目视通过。 | packages/nidofy/desktop-extras/src/management-ui.ts |
| DS-UI-013 | 部分改善；保留高级能力 | 高级JSON折叠、用途与本地校验明确；并未改成全结构化表单，任意兼容映射仍在高级JSON中编辑。 | apps/desktop-host/src/connections/ui.ts |
| DS-UI-014 | 保留安全步骤；已简化入口 | 选择动作已填短语；预览/确认承担权限、scope、expiry，不能删掉。 | packages/nidofy/desktop-extras/src/client/NaturalSettings.tsx |
| DS-UI-015 | 保留非模态窗口设计 | 管理页有独立任务栏/生命周期，支持与主会话对照；复用和隐藏加载修复，不加modal或强制置顶父窗。 | apps/desktop/src/panels.ts |
| DS-UI-016 | 已改并测 | 面板隐藏加载完成后显示，失败销毁。 | apps/desktop/src/panels.ts |
| DS-UI-017 | 已改并测 | 有界JSON读取真实业务错误，未知/超限保守失败；companion client请求回归覆盖。 | packages/nidofy/desktop-extras/src/client/companion.ts |
| DS-UI-018 | 已改并测 | 同 DS009。 | packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx |
| DS-UI-019 | 已改 | Models footer注册托管连接只读清单、凭据可用性与独立管理入口，不接管官方provider编辑器。 | packages/client/ui-settings-models/src/client/ModelsSection.tsx |
| DS-UI-020 | 已改并测 | 按完整规范 URL 复用及并发去重，取消不销毁已被他人使用的窗口。 | apps/desktop/tests/panels.spec.ts |
| DS-UI-021 | 已改并测 | 保存失败保留key；新连接缺key本地拒绝并显示准确消息，未提交不冒称结果不明。 | apps/desktop-host/src/connections/ui.ts |
| DS-UI-022 | 已改 | 导入候选明确标示建议/尚未生效，与已配置连接区分。 | apps/desktop-host/src/connections/ui.ts |
| DS-UI-023 | 已改并测 | 纯命令回执移除恒未知模型四行，说明无完整运行绑定并指向有覆盖记录的工程任务比较；不伪造关联。 | apps/desktop-host/src/experiments/ui.ts |
| DS-UI-024 | 已改并明确限制 | 诊断说明SDK桶计数与provider显式零不同；未知/覆盖保留，不把缺值当测得零。 | packages/nidofy/desktop-extras/tests/diagnostic-coverage.spec.ts |
| DS-UI-025 | 已改并测 | 三计费桶且任一记录缺覆盖则总命中率未知，保留 known/total。 | packages/nidofy/desktop-extras/tests/diagnostic-coverage.spec.ts |
| DS-UI-026 | 已改并测 | 主面板打开仍保留伴随导航入口。 | packages/nidofy/desktop-extras/src/client/Environment.tsx |
| DS-UI-027 | 已改并测 | 恢复页按钮经主进程校验准确ID并只读确认会话存在后导航主窗；不续跑、不取得取消权限。 | apps/desktop-host/src/workbench/ui.ts |
| DS-UI-028 | 已改 | 明确最多100近期主会话，同时支持输入准确已保留ID检查其他会话。 | apps/desktop-host/src/workbench/owner.ts |
| DS-UI-029 | 已改 | 预览显示实际repository permission，fullAccess仍需独立显式授权。 | packages/nidofy/desktop-extras/src/client/EnvironmentExplorer.tsx |
| DS-UI-030 | 已改并测 | pending session baseline 显示加载而不是空列表。 | packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx |
| DS-UI-031 | 已改并测 | environment/protection/connection 导航已接线。 | packages/nidofy/desktop-extras/src/client/Environment.tsx |
| DS-UI-032 | 已改并测 | 默认不抢焦点，显式菜单期间临时焦点并归还。 | apps/desktop/tests/pet-lifecycle.spec.ts |
| DS-UI-033 | 已改并测 | 瞬断保留窗口但撤销 stale snapshot 的导航/pin/interaction；drag 本地清理不依赖 freshness。 | apps/desktop/tests/pet-lifecycle.spec.ts |
| DS-UI-034 | 已改并测 | Host 管理文档不启动主窗菜单/appearance 观察挂载。 | apps/desktop/src/preload-app.ts |
| DS-UI-035 | 已改并测 | 564个初始副本、缺reference引发的92个新副本（reference已修）、38+8个旧声明/map及46个旧API JS/map，共748文件按独立manifest可逆归档；后两批mtime为10/12而非本轮构建重生。最终四类root扫描零残留。实际packed API client.js与本地构建逐字相同，映射内19份API源码与当前TS逐字相同，不仅凭map后缀判断。 | .build/dispatch/evidence/relay-37/generated-source-moved.json |
| DS-UI-036 | 已改 | Notebook 自有 scoped 样式，独立装配仍可用。 | packages/nidofy/working-notebook/src/client/style.ts |
| DS-UI-037 | 已改并测 | 单一 task-recovery 实现，Host 通过公开 package 子导出复用。 | packages/nidofy/desktop-extras/src/task-recovery.ts |
| DS-UI-038 | 已改并测 | step/turn 结束遗留调用标记 unconfirmed，无虚构结果或时长；独立观察数据不冒充权威 toolview。 | packages/nidofy/desktop-extras/tests/diagnostic-coverage.spec.ts |
| DS-UI-039 | 保留领域差异 | 相似短格式器分别服务usage/诊断与不同locale命名空间，不构成已验证行为缺陷；不为行数做跨包耦合。 | packages/client/ui-chat/src/client |
| DS-UI-040 | 无运行时消费 | legacy/cache-probe没有import consumer，tsdown不打入产物且package files不含src；保留源文件供历史定位，非可见运行入口。 | packages/nidofy/desktop-extras/src/legacy/cache-probe.mjs |
| DS-UI-041 | 已改；保留不同领域状态 | 会话turn原因共用task-recovery；Job/verification/engineering有各自生命周期，不强行合并不同枚举。 | packages/nidofy/desktop-extras/src/task-recovery.ts |
| DS-UI-042 | 已改并测 | tabs 角色/关联/键盘 roving focus 完整。 | packages/nidofy/desktop-extras/src/ui.ts |
| DS-UI-043 | 已改 | Host select/input/textarea有显式label或aria-label，图像文件选择也有可访问名。 | apps/desktop-host/src/workbench/ui.ts |
| DS-UI-044 | 报告已撤回 | 复合选择器没有命中 composer/connection；后续 DS075 是隐式耦合。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| DS-UI-045 | 已改 | 语义色使用现有 token。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| DS-UI-046 | 已改 | 共享 elevation token。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| DS-UI-047 | 已改 | 0.5px 边框。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| DS-UI-048 | 已改 | 次级文本 token 与规范圆角。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| DS-UI-049 | 已改 | 中文/英文Host脚本解析及交互验证；移除陈旧页脚与双语新控件同更。 | packages/nidofy/desktop-extras/src/ui.ts |
| DS-UI-050 | 已改 | 官方16px图标。 | packages/nidofy/desktop-extras/src/client/EnvironmentIcon.tsx |
| DS-UI-051 | 已改 | 伴随/Notebook错误为摘要加details，保留有信息的短加载状态。 | packages/nidofy/desktop-extras/src/client/EnvironmentExplorer.tsx |
| DS-UI-052 | 已改并测 | 应用 locale 日期，测试固定 TZ。 | packages/nidofy/desktop-extras/src/client/AnalysisHistory.tsx |
| DS-UI-053 | 已改 | 更新弹窗使用window-material和light/dark变量；源码检查完成，实际更新弹窗未触发，管理页实机主题不替代此项。 | apps/desktop/renderer/update-dialog.css |
| DS-UI-054 | 已改 | dock 对称间距。 | packages/nidofy/desktop-extras/src/client/appearance.ts |
| DS-UI-055 | 无行为缺陷 | 单页忽略无意义tab参数；full URL去重仍保留请求参数与scope，不以此移除定位语义。 | apps/desktop/src/main.ts |
| DS-UI-056 | 已改并测 | 只拦实际成功拥有的managed路由；保存前与提交前预检冲突、最终原子注册拒绝，不声称全局异步预留锁。 | apps/desktop-host/src/connections/store.ts |
| DS-UI-057 | 已改并测 | immutable revision 缓存解析 profile/metadata；请求 adapter 仍每次捕获新 lease。 | apps/desktop-host/src/connections/runtime.ts |
| DS-UI-058 | 已改并测 | 逐组Show more进入可选v5视图字段，重挂载回归保留展开批次。 | packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx |
| DS-UI-059 | 报告泛化不成立 | 已保存无工作区会话含blank可恢复，现成workspaces-service回归已覆盖；尚未创建Session的空白入口偏好未单独持久化，不是会话丢失。 | packages/client/ui-workspace/src/client/navigation.ts |
| DS-UI-060 | 已改并测；默认保留 | 取消气泡已补；默认关闭是用户 opt-in 偏好。 | packages/nidofy/desktop-extras/assets/pet/state.js |
| DS-UI-061 | 已改并测；默认关闭 | Settings增加显式通知偏好，CAS失败必须重新读取；不默认开启或重放历史。 | apps/desktop/src/workbench.ts |
| DS-UI-062 | 已改 | 内部工程 Session owner WeakSet 过滤，子代理同样过滤。 | apps/desktop-host/src/workbench/owner.ts |
| DS-UI-063 | 已改并测 | 客户端Settings消费既有通知读取IPC，与061共用实现。 | apps/desktop/src/preload-app.ts |
| DS-UI-064 | 源码与核心测试完成；资格另列 | 使用合成闭包不跳过核心测试；静态图失败有可读提示。实际 p37f 本地资源/SDK/GPU canvas 渲染及明确停止通过，发行权利尚未确认。 | packages/nidofy/desktop-extras/tests/fixed-live2d.client.spec.ts |
| DS-UI-065 | 已改并测；系统级穿透未自动覆盖 | alpha hit-test + forward mousemove；菜单键盘/focus/blur 成对清理。真实 Windows 鼠标穿透/物理焦点未自动操作验证，不以 mocked Electron 回归替代。 | apps/desktop/tests/pet-lifecycle.spec.ts |
| DS-UI-066 | 已改并测 | 动态入口失败显示 degraded 窗口；loadURL 失败销毁后限频重试。 | packages/nidofy/desktop-extras/assets/pet/pet.js |
| DS-UI-067 | 已改并真实组装测 | manifest 解除 extras 强注入；无 Companion 的生产 roster 可在 Settings 打开笔记，未发送模型请求；禁用 extras 的自有页面404仍需说明。 | packages/nidofy/desktop-extras/tests/companion.client.spec.ts |
| DS-UI-068 | 已改并测 | 与020同实现，完整URL并发复用。 | apps/desktop/src/panels.ts |
| DS-UI-069 | 明确延期 | 同源第三方代码信任边界存在；独立隔离渲染架构未实施，无已证漏洞；script 响应 CSP/删标签不能撤销文档权限；默认动画仍显式启用，发行授权未确认。 | packages/nidofy/desktop-extras/src/client/fixed-live2d.ts |
| DS-UI-070 | 已改 | 业务插件不再声明 immediately；不宣称未测量的启动加速。 | packages/nidofy/desktop-extras/package.json |
| DS-UI-071 | 保留设计／内容约束 | 更新报告明确Idle-only为有意设计；不新增未经提供的动作或分发资格，不列为新功能义务。 | packages/nidofy/desktop-extras/src/client/fixed-live2d.ts |
| DS-UI-072 | 已改并测 | 共享加载器按调用生命周期取消、超时、移除标签并允许失败重试；已执行 Core global 不声称卸载。 | packages/nidofy/desktop-extras/tests/offline-script.client.spec.ts |
| DS-UI-073 | 已改 | 删除死locale，显示selectedPet affinity，vision maxTokens有限数值控件。 | packages/nidofy/desktop-extras/src/ui.ts |
| DS-UI-074 | 产物精确排除；源保留 | 两棵xiaojing树均有consumer，保留webp/manifest/JS；仅package files排除无运行consumer的PNG预览副本、preview/checksums/staging与说明，实际 tgz 清单确认两套运行webp存在且被排除预览/staging不存在。 | apps/desktop/scripts/electron-builder-config.mjs |
| DS-UI-075 | 已改；契约同步 | 显式data-conversation-surface=main用于外观定位；原data-chat-phase状态语义不变。 | packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx |


最终实际包证据：`.build/dispatch/evidence/relay-37/settings-ub58eF/result.json`，六张截图，pageerror=0、模型请求=0、sandbox=true、注册表未变。有限CSS入场动画完成后截屏，根代理目视通过。正式构建、包内容SHA、文档门禁与保留限制详见 [Relay37交接](relay-37-astra.md)。
