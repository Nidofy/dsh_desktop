# 0.2.5-rc.1 候选与后续验证

当前交付对象为固定源码 Harness 的独立 Tauri 候选，正式用户资料不自动挂载，旧发布目录保留。用户已授权本地里程碑提交；没有授权远端推送或在线发布。

本机完整构建和最终回执 EXE 的原生任务、重启、历史恢复及退出均通过。交付目录只有通过完整文件清单、许可证、受限 PATH 离线 smoke 和构建回执复核后才生成成功记录。当前结果见 [交付记录](docs/RELEASE-0.2.5-rc.1.md) 和 `MVP_STATUS.json`。没有未解决的数据迁移阻断。

额外 Harness SDK `text-turn` 回放仍有 feedback 事件断言失败，原因未定位；[失败记录](docs/evidence/0.2.5/catalog-provider-fork.json) 和原始日志保留，不能宣称 SDK 全部通过。它不替代或取消实际桌面 Gate。

真实内网、实际缓存收益、睡眠、混合 DPI、触控/笔、长期性能、干净企业镜像与系统级离线流量仍未完成现场验收。本机 mock 或受限 PATH 不能证明这些项目通过。旧 0.2.0 状态保存在 `MVP_STATUS.json` 的 historical020Baseline，历史审计及旧证据保持原样。
