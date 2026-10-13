# T13 第二完整应用窗口的 Main 授权决定

## 当前事实

Relay 12 已通过真实生产 Main／preload／Web 页面和认证 Host 的主页面／工作台双窗口、完整 scope IPC、延迟隐藏目标取消、快速切换／重连、关注释放、Notebook Host／Client 热启停、宽窄／语言／主题／缩放、草稿／附件／光标与合成 composition 事件保护。源码四文件十八项、另行实际 Electron 一文件一项，层次不相加。当前正式 Main 授权没有扩大。

同一 Host 的第二完整 `dsh-app://app/` 页面则没有启动资格：实际第二 BrowserWindow ID=4，locale bootstrap 被拒绝为 unowned frame，WebSocket refused。稳定复现和诊断分别为 `.build/dispatch/evidence/relay-12/carrier-oDk2XZ/result.json` 和同目录 `main.log`；第一次实际失败为 `carrier-NdslVr`。这些是与原 Main 所有权规则一致的拒绝，不是连接恢复、账本或 Notebook 架构失败。

## 最小复现

在 Electron 主目录运行已有本地 Node：

```powershell
node apps/desktop/tests/fixtures/companion-carrier.mjs .build/dispatch/evidence/relay-12 --probe-second-app
```

该操作使用保留的本地 Electron 二进制、当前 Main／preload 和 Client bundle、完整隔离 Host，仅创建新的测试 appData／home／workspace。前九组载体行为通过后，测试创建实际第二完整 root 窗口，直接观察正式 locale bootstrap 和实际 WebSocket 的拒绝。退出码零表示已观察预期拒绝，不能记为第二完整窗口通过。`--probe-second-app` 没有增加任何产品权限。

## 需决定的具体范围

- `apps/desktop/src/main.ts` 当前 `mainWindow` 同时充当主窗口生命周期、部分产品 IPC、locale bootstrap 和 WebSocket cookie 附加的授权 owner。`windowIdentity`、scope publication 和原生 panel capture 可以校验实际发送窗口，但它们不授予第二 root 页面 locale 或流认证。
- `apps/desktop/src/ipc.ts`／`preload-app.ts` 只暴露当前桥接；`companion-navigation.ts` 校验完整 scope 和实际 window ID。不能把同 origin 当作任意原生窗口的永久授权，也不能伪造 host/window/view 身份绕过 bootstrap。
- 首先决定 T13 的“双窗口”是否限于当前已支持的主页面／工作台，还是产品必须支持同 Host 的两个完整 Conversation root。前者需要明确能力范围；后者需要 Main 显式拥有 root 窗口集合及 document 生命周期，选择、草稿和 renderer 观察独立，最小 locale/stream bootstrap 权限仅给这些已登记窗口的当前顶层 document。浏览器 guests、子 frame、独立 HTML 工作台和任意同 origin 窗口不得因此取得产品控制权限；现有只对 primary 开放的命令需要分别分类，不机械放宽。
- 完整第二 root 若获准，需要真实同 Host 双 root、document reload／销毁、跨 sender scope 拒绝、隐藏目标取消和旧 Host cookie 清理回归，并同步全部受影响消费者。不要仅替换一处 `mainWindow` 判断。

## 自动审批拒绝

自动审批拒绝了把 WebSocket 和 locale IPC 从 primary 放宽到任意同应用 BrowserWindow 的补丁，原因是永久扩大安全边界、没有准确的影响范围批准。该补丁没有落盘，也没有换工具绕过。Relay 12 改用现有授权的主页面／工作台载体验证，完成独立的 T17 有界中文检索和来源引用后交接这个新的权限决定。Astra 需要确定具体窗口所有权及最小授权方案；这不是重新审查 Relay 05／08 或 W04／T10。

## 其他资格限制

系统实际中文 IME 输入、跨物理显示器 DPI、已安装 OS 通知、安装包及正式顶层 recorded-session snapshot 仍未获得本棒资格。T17 是保留官方 FTS 的有界近期子串退路，已经验证真实 generation／seq／原事件摘要、exact cwd、来源重验、冷重建和显式草稿引用；全历史子串索引与用户显式跨 worktree 分组未实现，T18 正式 Hint 未发布。
