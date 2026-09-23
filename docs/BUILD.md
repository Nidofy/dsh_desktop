# Developer build

Harness fork 的源码构建、固定提交、独立候选导入与 `-HarnessSourceArtifact` 入口见 [源码工作流](HARNESS_SOURCE.md)。当前源码候选 0.1.7-alpha.2 尚未完成桌面适配；默认 registry 构建与 0.2.4-rc.2 的引擎组合保持不变。
M1 增量门禁与未测范围见 [实施记录](IMPLEMENTATION-M1.md)；fork 中未经提交固定的 hook 不得冒用旧 commit 的源码回执。

0.1.7 adds `tests/experiments.mjs`. Use `scripts/build-windows.ps1 -ReusePreparedRuntime -SkipPackage` to run checks and compile without creating an offline ZIP. Runner fixtures and live opt-in instructions: [0.1.7 experiments](EXPERIMENTS-0.1.7.md).

Version 0.1.6 additionally runs `tests/observability.mjs` and `tests/observability-wire.mjs`. Use `runtime/runtime/node.exe tests/observability-benchmark.mjs` for the separate synthetic ON/OFF CPU/memory probe. Portable archives are versioned (`DSHDesktop-0.1.6-win-x64-portable.zip`) so the prior unversioned package is preserved.

Build on Windows x64. Tested compiler: Rust 1.97.1 with Visual Studio 2026 MSVC. Put `cargo`/`rustc` on the developer PATH. Node/npm are build-time tools only. All direct versions are in `versions.json` and `src-tauri/Cargo.toml`; the complete npm/Cargo resolutions are committed in `build-deps/package-lock.json` and `src-tauri/Cargo.lock`.

```powershell
.\scripts\build-windows.ps1
# Reuse a previously verified staging tree:
.\scripts\build-windows.ps1 -ReusePreparedRuntime
```

Stages: verify build tools → pinned official Node → `npm ci --omit=dev` → pinned Microsoft WebView2 Fixed Version CAB (hash/signature/file inventory) → local icon/wallpaper conversion → release Rust tests → locked release build → copy full production and browser trees → collect original licenses → offline smoke → ZIP with folder icon metadata → SHA256.

Version 0.1.3 also runs `tests/protocol-models.mjs` after the Rust tests. The Rust configuration test emits production overlays under `.build/config-protocol-fixtures`; the Node integration check consumes them and exercises OpenAI and Anthropic locally, including streaming, native tool use, model switching and persistence. Re-run the Rust tests first when invoking this integration check directly.

Node and DSH dependencies are not installed at runtime. Do not copy a macOS/Linux node_modules tree into a Windows package. No tree pruning, bundling transform, upstream patch or package-manager executable is added by the wrapper. Package scripts operate only on build directories. Packaging never recursively deletes an old artifact directory.

Direct build:

```powershell
./scripts/fetch-webview2.ps1
./runtime/runtime/node.exe scripts/sync-desktop-theme.mjs
./runtime/runtime/node.exe scripts/sync-desktop-runtime.mjs
./runtime/runtime/node.exe scripts/runtime-integrity.mjs create-runtime
node scripts/make-icon.mjs
cargo test --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
cargo build --locked --release --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

0.2.0 开发基线额外验证 Project Actions、共享主题、连接迁移/网络、原生任务恢复、通知、缓存探针/配置契约、Git/Hg 变更基线及产物路径/下载契约。`tests/change-review.mjs` 单独运行默认使用真实 Git；0.2.0 候选构建强制加 `--hg`，需先在 `.build/hg-test-venv` 安装 Mercurial 7.2.2。完整门禁同时验证缺失 VCS 的跳过行为与真实 Git/Hg 自检，不能用缺失工具时跳过来代替求解器工程所需的 Hg 验证。`tests/change-review-wire.mjs` 验证原生任务采集时序。`tests/profile-network.mjs` 在本机生成短期测试证书，开发机需要 Git for Windows 的 OpenSSL，或用 `DSH_TEST_OPENSSL` 指定可执行文件路径；产品运行不依赖 OpenSSL。运行时同步脚本必须复制 `desktop-client` 子目录，不能只复制顶层 `.mjs` 文件。

`.cargo/config.toml` links the desktop CRT statically. The Node binary and upstream native npm dependencies retain their upstream build choices; clean-image DLL verification is still required.

Rust 测试还覆盖原生文件快照与恢复（`task_snapshots::tests`），包含实际 Windows 文件共享锁、目录固定、junction/硬链接/命名数据流，以及部分写入故障注入。测试使用随机临时目录；需要正常 Windows 宿主访问磁盘祖先目录，不能用放宽产品权限的方法绕过嵌套 sandbox 限制。设置页快照的浏览器 fixture 可用 `node tests/settings-ui-preview.mjs` 查看，但不代替原生 Tauri IPC 验收。

缓存前缀门禁：`tests/prefix-regression.mjs` 验证分类和窄范围提示扩展；`tests/prefix-regression-wire.mjs` 通过真实 DSH / localhost HTTP 验证两个协议各 19 项连续请求、重试、重启、Skill、规则、权限、工具、压缩和模型切换。后者依赖 Rust 测试生成的配置 fixture，构建脚本已接入。报告与判定边界见 [前缀回归](PREFIX_REGRESSION.md)。

自检中心：运行时同步现在生成 `desktop-runtime-manifest.json`（固定版本和桌面扩展 SHA-256）。构建执行 `tests/self-test.mjs` 与 `tests/observability-wire.mjs runtime --self-test-only`；后者保留最小 PATH，验证缺失 VCS 的准确跳过。另用 `--self-test-vcs` 验证真实 Git 和测试环境 Mercurial。产品自检与开发证据边界见 [自检中心](SELF_TEST_CENTER.md)。

Some restricted agent execution environments cannot create a second Windows restricted token. The native DSH shell smoke then reports Win32 87. Run the build/smoke under a normal **non-elevated** developer account outside the agent's nested sandbox. Do not change DSH to `danger-full-access` to pass tests. The working verification run had `AdministratorToken=False`.

`tests/runtime-smoke.mjs` uses the packaged node.exe, removes developer tools from child PATH, uses fresh Chinese/space/parenthesis paths, an HTTP mock, and a test-only network interception preload. It must never be represented as a firewall/VM or WebView-wide egress proof.

独立缓存键使用固定 hash 的 DSH 适配器内存扩展（schema + pi-ai 公开 onPayload 钩子），磁盘中的上游包保持原样。`tests/desktop-cache-key.mjs` 校验来源 hash、旧配置默认、键隔离与不改其他字段；`tests/observability-wire.mjs runtime --cache-key-only` 验证最终双协议 HTTP。构建脚本已纳入两项门禁；上游适配器升级未重新审查时会阻止启动，不静默忽略独立键配置。

Changing DSH requires repeating the investigation, provider contract tests, complete production install, native tools test, network audit and clean-image acceptance. The new CLI guards `runCli()` with `import.meta.main`; an imported-only CLI is inert. The wrapper uses `node --import host.mjs <official-bin> web ...` so the official entry remains main.

完整性门禁：依赖安装后生成 `dsh-integrity.json`；`create-runtime` 在验证依赖、Node、模块和 WebView2 基线后生成整树 `runtime-integrity.json`。复用目录缺少依赖清单时先重新执行受信锁文件安装；打包只验证，不在最后一刻重新采纳依赖或同步源码。打包再生成全包清单，并在 ZIP 内容逐项通过后发布文件名和 SHA256。详见 [运行时与离线包完整性](RUNTIME_INTEGRITY.md)。新增 `tests/runtime-integrity.mjs`、`tests/distribution-verifier.mjs` 和 `tests/archive-integrity.ps1` 已纳入构建门禁，独立 PowerShell 校验不改变执行策略。


## 同一次构建的文件绑定

完整构建在生成主题、图标和运行时之后，用 `scripts/release-receipt.mjs begin` 记录源码、设置页、资源输入、测试、构建脚本、权限声明及锁文件的清单。所有门禁与 release 编译通过后再次核对输入及运行时，才生成 `.build/release-build-receipt.json`。最新构建尚未完成或失败时，旧记录不能代表该次构建通过。

`package-portable.ps1` 必须先验证这份记录，暂存后和压缩发布前再次验证；源文件、设置页、EXE 或运行时清单变化会拒绝打包，要求重新运行完整构建。包中 `BUILD_RECEIPT.json` 保留对应记录；暂存 EXE 也须匹配已验证构建的指纹。直接 `cargo build` 仍可用于开发，但不会产生可发布的完整门禁记录。

这份记录用于防止旧 EXE 和新资源误混装，不是数字签名，也不代表真实网关、原生点击或企业目标机通过。文档由包内完整性清单覆盖，开发证据文档可在门禁结束后更新，不会被误当成需要重新编译的源码。`tests/release-receipt.mjs` 验证旧记录、运行中修改、额外源文件、EXE/运行时变化和版本不一致时拒绝。

源码引擎 Gate 同时需要旧 `0.1.5-rc.2` 运行时，供真实旧 writer 迁移和旧缓存桥回归使用。首次 `-HarnessSourceArtifact` 准备成功会自动使用保留的旧目录；后续复用源码运行时须传 `-LegacyRuntime <完整旧目录>`。该参数不会跳过旧引擎版本检查。源码分支额外执行 profile、不可变迁移、热应用和本地窗口命令权限检查。协议 fixture 默认位于用户临时目录，可用 `DSH_TEST_FIXTURE_ROOT` 指定，测试仍保留 Harness 自身沙箱。

开发阶段可用 `scripts/seal-source-qualification.mjs <artifact> <resources>` 校验并封存桌面模块更新后的隔离 qualification 目录。它先逐文件验证原始源码依赖、Node、WebView2 和已同步桌面模块，且只接受 `productionAdmission:false` 标记；不会生成 release receipt 或批准产品准入。

## 0.2.0 完整目录交付（不压缩 ZIP）

```powershell
.\scripts\build-windows.ps1 -ReusePreparedRuntime -SkipPackage
.\scripts\package-portable.ps1 -SkipArchive
```

第二条命令生成 `dist/DSHDesktop-<version>-win-x64`（已有同名目录时增加后缀），仍执行构建回执、EXE 指纹、许可证清单、全目录清单和离线运行验证。成功后 `.build/latest-staged-package.json` 保存实际目录与构建 ID；不会生成或替换 ZIP。默认不传 `-SkipArchive` 时继续原有 ZIP 流程。
