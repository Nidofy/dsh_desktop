# 登录返回重复实例修复

修复版沿用 Notebook 候选的官方 `0.2.0-rc.2` 引擎与插件，仅更新 Electron 登录返回与数据目录选择。入口为 [试用启动脚本](../electron/migration/n-context/launch-trial.ps1)，仍使用 `.desktop-build/n-context-trial-data`，旧候选包保留。运行前需从应用菜单或托盘退出旧版，避免旧进程继续持有同一目录的单实例锁。

## 原因与处理

试用启动器通过 `NIDOFY_DESKTOP_DATA_ROOT` 指定独立目录。Windows 浏览器通过协议启动程序时不继承该变量，旧代码因此可能使用默认目录取得另一把单实例锁。旧代码还在私有版启动时注册官方 `dsh` 协议，与私有发行协议不一致。

Windows 协议注册现在携带绝对目录参数，在单实例锁之前恢复原目录。私有版启动时注册自己的协议；个人版打开官方登录浏览器前，将官方完成页的 `dsh://open` 绑定到当前程序及目录。已有实例时唤醒原窗口，额外进程退出；冷启动时恢复同一目录。Windows 每种协议仅有一个默认处理程序，不支持不同安装同时发起官方登录。

## 验证

- 121 项定向测试通过，包含注册顺序、账号通知去重、单实例、欢迎页与启动行为；登录注册行为有固定快照。
- 实包 6 项检查通过：中文与空格目录、缺少启动器环境变量、冲突环境变量、Windows 私有协议唤起、官方 `dsh://open` 唤起、冷启动目录保持。已有实例的 PID、窗口和目录保持一致，第二个进程退出。
- Desktop TypeScript 构建通过；文档检查 43 项通过。
- 使用隔离目录并还原临时协议注册，未使用用户账号凭据。真实账号授权全过程尚未重新执行，已验证其完成页使用的 Windows 返回路径。

证据：[登录返回检查](../electron/migration/login-instance/evidence/protocol-return.json)、[单元测试](../electron/migration/login-instance/evidence/unit-tests.log)、[文档检查](../electron/migration/login-instance/evidence/doc-sync.log)。

## 产物

修复包：`electron/apps/desktop/.desktop-build/targets/win-x64/candidates/n-login/personal-unsigned/win-unpacked/Nidofy DSH Desktop.exe`。

修复包 `app.asar` SHA-256：`accc2fcb9bf97d7ab79bd28927e35efb6d845091b8d8b4b87897fdba991d184f`。原 Notebook 候选 SHA-256 保持 `103bbabe9377c196a7f63efd925c81a8c65bb43d6b02538b96b722206eff76c5`。修复包为本地未签名候选，尚未安装或发布。
