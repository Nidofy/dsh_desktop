# 当前 Electron 候选范围

## Summary

Relay 36 提供当前源码构建的 Windows x64 便携目录、ZIP 和 EXE 入口，供本地使用。侧边分析、有限设置、桌宠协调、历史引用插入和固定模型 Live2D 已进入实际包。正式安装、签名与发行资格延期，历史结果仍独立保留。

## Table of Contents

- [能力](#能力)
- [数据与权限](#数据与权限)
- [Dev Note](#dev-note)

## 能力

| 能力 | 当前证据 | 限制 |
|---|---|---|
| 工程 Shell 资源 | 完整 observer 坐标、spill 身份核验、持续保留费用及后续执行拒绝；保留原 T11 结果 | 协作检查点；动作期间磁盘和 Host 内存峰值未知 |
| 侧边分析 | 实际包预览、一次官方请求、独立可回放记录、读取／筛选／归档／预算／导出、取消及显式草稿追加；真实 Loader 测试保留主历史并撤销权限 | 显式受管连接、零重试、选定文字 12 KiB、输出 2048 Token、显式共享 quota；活跃记录 1–20、归档记录 0–80；金额未知 |
| 有限设置与可选口吻 | 十二项有限选择、绑定 scope 与 owner 截止时间的预览、原 owner 回执、取消或丢失回执后明确读取当前设置、失败／陈旧状态撤下及冷重开偏好 | 仅有限已登记选择；口吻默认关闭，不增加权限；读取仅是快照，取消不撤销已提交动作，新预览须明确选择 |
| 角色、桌宠与历史 | 实际包：已配置实例选择和明确刷新启用／绑定／静音快照、绑定／解绑／静音／取消静音／互动、桌宠窗口、中文来源预览、显式草稿追加与单步撤销、宽窄 UI；保留早期 sender／过期／重复证据 | 不自动发消息或执行任务；历史覆盖仍有界 |
| Live2D | 用户提供 Cubism Web 5-r.5、真实固定模型、离线实际 WebGL、禁用 WebGL 回退；100 次启停后待执行帧／监听器／已跟踪 GPU 对象均为零，记录 CPU／进程内存检查点 | 仅 Idle；美术接缝与显存峰值未认证；保留本地 SDK 使用条件，不认证公开发行授权 |
| 便携 runtime 与入口 | 当前包在 .build/p36f 首启／重启、沙箱观察、Office／Host／runtime smoke；完整 ZIP 文件／长度清单；启动器接受专用稳定根并拒绝相对／无标记根 | 包内 Python 原生导入要求短程序路径；保留旧长路径和不完整 profile 失败；无安装器或协议注册 |
| Windows 安装与恢复 | 历史 Relay 29 载荷在唯一测试 NSIS 身份下通过安装、已安装 portable 启动／重启与卸载；新旧 Host 均可读 Session／偏好副本；旧 Host 可读未改动的原 Notebook | 生产身份安装要求干净账号／VM；文件副本改变物理代次，Notebook 正确拒绝 |
| Windows ACL 生命周期 | 写前持久快照、活跃租约重入、最后释放与崩溃恢复；真实 native 和实际制品隔离检查 | 无原快照的旧授权拒绝新 workspace-write 准入；独立 ACL 冲突保留日志；仅 Windows x64 |
| 其他资格 | 保留历史认证范围 | 干净机、真实休眠、物理混合 DPI、企业网络和签名未执行，不阻止本地功能完善 |

## 数据与权限

原生受管 quota 覆盖参与日志，不覆盖所有工程、Session、附件、Shell spill 或进程分配。自检 UNKNOWN 与缺失计数保持未知。角色与桌宠关注 Session，不认证 T11 run 或用户验收。可选分析／模型辅助整理保持独立请求和 token 成本；本地桌宠协调不增加模型调用或缓存收益。关闭 pets 后角色、Notebook 和通知 owner 继续可用。

私有数据根分离 Chromium 和 Harness 文件，但不隔离 Windows 注册。普通 Main 启动和个人登录保留既有正式协议行为。显式 portable 资格模式禁止注册及系统命令安装；观察到的正式注册键保持不变。生产身份安装器要求专用干净账号／VM。独立测试安装身份只认证其明确载荷和安装范围。私有版卸载即使未继承 DSH_HOME 也保留产品数据、包数据及更新缓存；修正候选为 personal-unsigned-retain-data。Relay 28 和最初 Relay 29 的不安全安装结果作为历史证据保留，不构成当前便携载荷资格；旧安装器文件已纳入明确清理。参见[卸载升级说明](../../docs/upgrade-guide/v0.2.0-rc.2/private-desktop-uninstall/guide.zh.md)。

恢复使用旧程序和升级前数据；新版数据不具备原地降级资格。原始 Session 与偏好文件副本可读，但绑定物理代次的 Notebook sidecar 拒绝改变后的文件身份。旧 Host 已从未改动的原物理文件恢复；完整 Notebook 副本或 VM 快照恢复仍未认证。未迁移真实数据，未签名、push、合并或发布。

两个真实项目根保留无已核验原备份的旧 S-1-4 授权。新机制拒绝对这类旧树自动重标，需已核验原备份或经过审阅且不复制安全描述符的新内容工作区。本轮未自动修复或迁移。见 [ACL 升级指南](../../docs/upgrade-guide/v0.2.0-rc.2/windows-acl-workspace-leases/guide.zh.md)。

已授权清理移除 45 项旧产物并释放 62.594 GiB。p35f、p34f 及各自 ZIP、relay-35-final2 和失败 relay-35-final 保留；更早证据、脚本、worktree 与源码资产保留。清理计划和结果在 ../.build/cleanup-20261013。

## Dev Note

当前命令、最终产物路径、截图和 .build/dispatch/evidence/relay-36 下的保留失败由 [Relay 36 记录](handoffs/relay-36-astra.md)负责。[Relay 31](handoffs/relay-31-sol.md) 保留其历史范围。[Relay 29](handoffs/relay-29-astra.md)、[Relay 28](handoffs/relay-28-sol.md)、M4／M5 及更早资格证据不变。本地使用说明随完整便携目录交付。
