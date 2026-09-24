# Harness fork、源码构建与产物接入

当前桌面继续使用 Tauri。Harness 的 fork 是引擎源码仓库；`dshWinUi` 保存桌面宿主、适配层、构建组合和交付流程。两者分别提交，桌面仓库通过固定 commit 与产物清单关联引擎，不复制整个上游源码，也不在用户机器上拉取或编译。

## 本机与版本

| 项目 | 当前值 |
|---|---|
| 桌面仓库 | `D:\Documents\FeiyangChen\devApps\dshWinUi` |
| Harness checkout | `D:\Documents\FeiyangChen\devApps\deepseek-harness` |
| origin | `https://github.com/Nidofy/deepseek-harness.git` |
| upstream | `https://github.com/deepseek-ai/deepseek-harness.git` |
| 本地集成分支 | `codex/tauri-integration` |
| 本次候选 commit | `5e2879f0478ba9336128312e715dee7a9f56c3db` |
| 本次候选引擎 | `0.1.7-alpha.2` |
| 源码包管理器 / Node | pnpm `11.7.0` / Node `24.16.0` |
| 当前开发候选 | `0.2.5-rc.1`，携带 DSH `0.1.7-alpha.2`；旧交付保留 |
| 旧引擎源码参照 | `dsh-v0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203` |

精确输入位于 [`build-deps/harness-source.json`](../build-deps/harness-source.json)，构建组合由 [`versions.json`](../versions.json) 指定。源码产物构建成功不等于桌面准入；实际适配、构建与原生交付结果见 [0.2.5 实施记录](IMPLEMENTATION-0.2.5.md)。fork 包含明确授权的 payload hook 与 catalogProvider 接口，其他桌面集成仍保存在本仓库。

## 首次准备与日常构建

本机 clone 和 remotes 已完成；以下 clone 命令仅用于其他开发机。不要在已有 checkout 上重复执行。

```powershell
git clone https://github.com/Nidofy/deepseek-harness.git ../deepseek-harness
git -C ../deepseek-harness remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git -C ../deepseek-harness fetch upstream --tags
git -C ../deepseek-harness switch -c codex/tauri-integration 00102833dfaee1da9f48a3a8eae9d34005a75218
```

在桌面仓库根目录执行，建议使用 PowerShell 7。构建机需 Git、Corepack、已准备的固定 Node，以及源依赖所需网络/缓存；最终用户无需安装这些工具。

```powershell
# 读取当前远端差异；加 -Fetch 才更新远端 refs，不 merge、不修改锁定值
./scripts/check-harness-upstream.ps1 -Fetch

# 从固定、干净的 checkout 构建官方 Host、client bundles 和 Web UI
./scripts/build-harness-source.ps1
# 也可指定另一份相同来源、相同 commit 的干净 checkout
./scripts/build-harness-source.ps1 -SourcePath D:/path/to/deepseek-harness

# 使用上一条命令输出的实际 artifact 路径；不会改 runtime/ 或 dist/
./scripts/prepare-harness-candidate.ps1 -ArtifactPath .build/harness-source/<run>/artifact

# 全新 home、仅 loopback 的独立 Web Host 检查
./runtime/runtime/node.exe tests/harness-source-smoke.mjs .build/harness-source/<run>/artifact
```

`-SkipInstall` 只适用于当前 checkout 的开发依赖已经通过 frozen install 的情况；默认安装包含 dev dependencies，避免部署动作留下的生产依赖状态破坏下一次编译。脚本使用固定 Node 执行 Corepack 的 JS 入口，不能依赖 Windows `corepack.cmd` 内部可能选到的另一份 Node。

流程依次执行：

1. 校验 origin、干净工作树、完整 commit、版本、Node/pnpm、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml` SHA-256。
2. `pnpm install --frozen-lockfile --prod=false`；`pnpm run build:official`。
3. 使用共享锁文件部署生产依赖，保留源锁与派生部署锁。禁用会重新解析依赖的 legacy 部署方案。
4. 按同一源码提交补齐 CLI 的 workspace 运行时依赖和 peer 闭包；通过各包的 `pnpm pack` 文件选择打包，不把整个源码目录当运行时。记录补齐包名、版本、来源及 tarball SHA-256。
5. 校验部署树不含外部链接或循环，再复制为无需 checkout 的实体文件。
6. 在独立 home 中执行已打包 CLI 的 `--version`、`--help`，复查文件未变，生成逐文件哈希清单；最后将 `artifact.pending` 改名为 `artifact`。
7. 候选导入先复制到新临时目录，完整校验后改名为新的候选目录，拒绝覆盖已有目录。

pnpm 会把上游已批准的 `dsh-subprocess-local` postinstall 的相对 file 引用改成绝对引用。构建脚本仅在源批准项存在、目标仍是该固定包且没有其他待批准脚本时翻译这一项；不启用“允许所有构建脚本”。未来上游改变该结构时应审查脚本，而不是忽略失败。

此流程固定输入并验证交付文件；尚未验证跨机器逐字节可复现构建。源码构建目录可能较大，不随离线包交付。

## 产物与正式入口

```text
.build/harness-source/<run>/
  source-build-start.json
  install.log / build.log / deploy*.log
  deploy-locked/                  # 构建中间结果
  workspace-packs/                # 同 commit 的补齐包
  artifact/
    source-artifact.json          # 来源、CLI smoke、逐文件 SHA-256
    runtime/dsh/                 # 独立生产依赖树与源/部署锁
.build/harness-candidates/<id>/
  dsh/
  dsh-integrity.json
  harness-source-artifact.json
  desktop-admission.json
```

固定源码组合通过适配资格验证后，显式运行完整构建：

```powershell
./scripts/build-windows.ps1 -HarnessSourceArtifact .build/harness-source/<run>/artifact -SkipPackage
```

这条命令在运行时准备前拒绝不匹配的引擎和未批准适配。不能只把 `desktopAdapterApproved` 改成 true 就当作适配完成：完整构建仍须执行协议、缓存、恢复、UI 及离线门禁。该参数不能与 `-ReusePreparedRuntime` 合用。0.2.5 不使用旧 registry 安装路径；复用已准备源码运行时时，必须同时传 `-LegacyRuntime <完整旧运行时>`，用于实际旧 writer 迁移与旧桥回归。

正式接入时 `prepare-dsh.ps1` 先在 `.build/source-prepared-*` 导入源依赖、复制固定 Node/WebView2、同步桌面扩展并验证完整 runtime；全部通过后才替换 runtime，将完整旧树保留在 `.build/source-previous-*`。普通替换失败会回滚；硬终止后的恢复已验证精确 journal、进程退出和新旧完整树指纹后进行。未知锁、资料变化或恢复冲突保留现场。具体测试与限制见 [0.2.5 记录](IMPLEMENTATION-0.2.5.md)。运行时校验会绑定源码 receipt、commit、版本、锁及每个文件，release receipt 也纳入源码 pin。

本机构建 `runtime/` 已通过原子暂存切换到固定源码，完整旧运行时保存在 `.build/source-previous-79580316a07746aea34a0e386513afd5`。这不修改用户数据或既有 dist。交付包必须匹配本轮完整 release receipt，不能沿用改动前的构建回执。fork 新接口目前只有本地提交，未推送；其他构建机需先获得对应提交的 checkout，不能假定远端已经包含它。

## 上游同步规则

- `origin/master` 跟随 fork 的上游同步；桌面所需的小范围引擎修改放在 `codex/tauri-integration` 或专门的 `codex/*` 分支，以可审查提交保存。不要把桌面 UI 和 Rust 宿主移入 Harness fork。
- 每周或准备一个桌面里程碑时执行 `check-harness-upstream.ps1 -Fetch`；这是检查频率建议，本轮未创建定时任务。紧急安全/崩溃修复单独评估。
- 阅读本地 Harness 的 AGENTS.md，再比较旧 pin 与候选提交的配置、数据格式、事件、模型协议和扩展接口。优先采用发布标签；alpha 可以做候选，不能因编译通过就作为稳定版本。
- 工作树有改动时先保存为明确的提交，不 reset/clean。已有共享分支不强推；新增同步分支合并上游、解决冲突，再更新桌面 pin 的 commit/version/两个锁哈希。
- 通用修复优先回馈官方；Tauri 平台桥接、内网连接及桌面业务留在桌面仓库。必须依赖内部 hook 时记录来源版本与兼容检查，避免积累无约束的生成文件替换。
- 每次桌面发布锁定“一套桌面 + 一套引擎 + 一套依赖”，只发布通过验收的组合。用户端不自行跟随 master，也不独立替换核心引擎。

本次实际结果见 [源码集成证据](evidence/harness-source-20260923.json)。CLI/Web Host 成功与原生 Tauri/真实内网/旧数据迁移验收分别记录。
