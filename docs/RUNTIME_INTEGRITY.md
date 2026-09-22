# 运行时与离线包完整性

0.2.0 开发基线使用分层清单检查文件缺失、修改和额外文件，不下载依赖、不修复或自动重装文件。它是相对于可信构建/发布包的完整性检查，不是独立数字签名、供应链审计或全局无出网证明。

## 构建与复用

1. `prepare-dsh.ps1` 在固定锁文件的 `npm ci` 成功后显式生成 `runtime/dsh-integrity.json`。记录 DSH 版本、锁文件 SHA-256 及整个生产依赖目录的逐文件字节数和 SHA-256。
2. 桌面同步仍生成 `desktop-runtime-manifest.json`，Microsoft Fixed WebView2 保持 CAB 来源及文件清单。
3. `scripts/runtime-integrity.mjs create-runtime` 先校验既有 DSH 基线、官方 Node hash、桌面模块与浏览器，再生成 `runtime-integrity.json`，覆盖整个运行时（只排除该清单自身）。
4. `verify-runtime` 只读验证，不重写清单。打包流程只接受已经验证的构建树，不在编译后静默同步桌面源码或重建依赖基线。

复用旧开发目录但缺少 DSH 清单时，先运行 `prepare-dsh.ps1`；不要在来历不明或已经损坏的目录上直接创建基线。`create-dsh` 是构建者显式采纳当前依赖安装结果的命令；正确用法是在受信锁文件安装后执行。清单会包含平台实际安装的可选依赖、命令垫片和安装时生成的文件，不把 macOS/Linux 依赖树复制到 Windows。

生成结果无时间戳，文件按路径排序；同一文件树产生同一清单。校验拒绝目录链接、非普通文件、路径跳转和大小写重复路径；总计最多 100000 文件 / 16 GiB、清单最多 32 MiB。读取文件前后复核文件身份与时间，避免采纳正在变化的文件。该检查不构成对恶意并发文件系统修改的防御边界。

## 自检

自检中心原「DSH 包版本」一项升级为「完整运行时文件」，检查整个运行时与 DSH 版本一致性；总项目数仍为 25。错误代码区分 `INTEGRITY_MISSING`、`INTEGRITY_CHANGED`、`INTEGRITY_EXTRA`、`INTEGRITY_UNSAFE`、`INTEGRITY_LIMIT` 和 `INTEGRITY_MANIFEST`，导出不带任意文件路径或异常正文。

完整扫描只在用户主动自检或构建/打包验证时执行，不增加每轮模型调用或每次应用启动的逐文件扫描。自检仍受 180 秒时限与取消控制；慢盘/企业扫描软件下可能超时，不能将未完成扫描标记 PASS。

## 离线包与 ZIP

打包前必须通过 `.build/release-build-receipt.json` 核对同一次完整门禁的输入、EXE 和运行时指纹；打包阶段生成 `package-integrity.json`，覆盖 EXE、运行时、文档、许可文本、`BUILD_RECEIPT.json` 及校验脚本。源码或资源在门禁后发生变化时需重新构建，不接受旧 EXE 混入新资源。包内 `Verify-DSHDesktop.ps1` 可在允许运行本地 PowerShell 脚本的环境执行：

```powershell
.\Verify-DSHDesktop.ps1
```

不需要 Node/npm 开发环境。脚本先核对捆绑 Node 的固定官方 hash，再核对校验模块与全包文件。包所在路径可通过 `-PackagePath` 指定。先从可信发布来源核对整个 ZIP 的 SHA-256；不要把包内清单自身当作独立信任根。

本机 Windows PowerShell 5.1 的执行策略拒绝了脚本测试，未修改或绕过策略；开发机 PowerShell 7 测试通过。脚本若被企业策略阻止，应使用获准环境或应用内自检，不要求用户关闭执行策略。PowerShell 5.1 与目标企业执行策略下的独立脚本运行仍需现场验收。

最终 ZIP 先写入唯一候选文件；压缩后直接读取每个 ZIP 文件项，核对长度、SHA-256、完整文件集合和包内清单，并拒绝多余/重复/不安全路径及链接项。验证通过才改为发布文件名并生成 SHA256。已存在同名包时保留旧包，新包使用唯一后缀；每个发布 ZIP 有独立 `.sha256` 文件。验证失败的候选文件不会取得发布文件名。

这也覆盖 `Compress-Archive` 可能跳过隐藏文件的问题：文件夹图标的 `desktop.ini` 显式补入 ZIP，其他任何遗漏均使归档校验失败，不以目录烟测替代 ZIP 实际内容检查。

## 当前证据与边界

- 本轮按锁文件用本机 npm 缓存重新安装 518 个包，DSH 清单 25453 个文件；完整运行时清单 25760 个文件、1022174728 字节。
- 真实 DSH 双协议自检通过，完整文件检查实测约 3.7 秒，本机全部自检约 8 秒；这是此开发机结果，不是其他机器的性能承诺。证据 `.build/observability-wire-9huyJm`。
- `tests/runtime-integrity.mjs`：完整集合、确定性、缺失/修改/额外、路径/大小写重复、目录链接、取消和 Node pin。
- `tests/distribution-verifier.mjs`：真实捆绑 Node、合成小型包、额外文件、改动及校验模块被改动时执行前拒绝；开发机 PowerShell 7 通过，5.1 策略拒绝。
- `tests/archive-integrity.ps1`：合成 ZIP 正常、遗漏、额外、大小写重复、路径跳转及内容变化。

本轮未生成新的产品 ZIP，未进行干净 Windows、企业策略、目标网关或真实原生窗口验收，当前仍是开发基线。
