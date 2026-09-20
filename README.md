# DSHDesktop

Windows x64 的 Tauri 2 桌面壳，直接运行官方 DeepSeek Harness 和原生 Web UI。完整携带运行环境，无首次启动下载，无桌面自动更新。

**当前是工程候选版，尚未通过全部 MVP 验收。** 已实测原生 workspace、session、文件读写、PowerShell、mock API 和受限网络下的后端运行；0.1.1 已检查实际窗口外观、欢迎说明确认与正常关闭。干净虚拟机、完整设置交互及 Windows 退出矩阵尚未验收，详见 [测试报告](docs/TEST_REPORT.md)。不得据此标注 `DSH_DESKTOP_MVP_ACCEPTED`。

## 使用

桌面壳 **0.1.2** 已内置 WebView2 Fixed Version，修复未预装 WebView2 的内网电脑无法启动的问题，并保留用户提供的图标与透明背景。首次打开看到的“DSH 0.1 仍在测试”是官方欢迎说明；随包引擎的完整版本为 **0.1.5-rc.2**。

1. 将 `DSHDesktop-win-x64-portable.zip` 完整解压到当前用户拥有的本机目录，保留目录内全部文件。不要在压缩包、网络共享或 Program Files 中直接运行。
2. 双击 `DSHDesktop.exe`。
3. 在 Connection Settings 填写 Base URL、API Key 和 Model，点击“保存并重启引擎”。V1 连接设置使用 OpenAI Chat Completions 协议；Base URL 通常以 `/v1` 结尾。
4. 在原生 DSH 窗口打开代码 Workspace。
5. 使用 DSH。`Help → Settings / Diagnostics` 可返回设置、复制诊断、打开日志或重启引擎。

需要 Windows 10/11 x64。**无需预装或安装 WebView2**：窗口使用 `resources/webview2` 中随包的微软 Fixed Version 运行时。Windows 10 首次运行会给该浏览器目录设置沙箱所需的读取/执行权限，不请求管理员权限、不修改系统 WebView2。请解压到自己拥有的本机目录。

API Key 保存到当前 Windows 用户的凭据管理器，页面不会回显；同一 Base URL 再次保存时留空表示保留原密钥，改换地址需要提供该地址的密钥。其余数据位于 `%LOCALAPPDATA%\DSHDesktop`。关闭主窗口会退出；只关闭设置窗口会隐藏该窗口。第二次启动退出，不创建另一套引擎。

先结束当前任务，再重启引擎或退出。离线包只支持随包提供的插件及已有配置；新增插件应由构建者制作下一版离线包。用户主动调用网络工具或 MCP 时，仍需要相应目标网络权限。

已知限制：内置下载操作当前被拒绝；外部弹窗链接仅交给系统浏览器；主窗口不允许跳转到外部站点。未签名，企业应用执行策略可能拒绝运行，应由企业按内部流程分发。

## Developer Build

仅开发者构建机需要 Node/npm、Rust 和 MSVC C++ build tools，允许访问 npm registry、Cargo、GitHub、Node 官方站点。

```powershell
git clone https://github.com/Nidofy/dsh_desktop.git
cd dsh_desktop
```

Git 管理源码、图片资源、依赖锁文件、构建脚本和测试记录。`runtime/`、`dist/`、`.build/`、`node_modules/` 和 Rust 构建产物保留在本地，由构建脚本准备；克隆源码后需要在联网的 Windows 构建机上生成离线包。

```powershell
.\scripts\build-windows.ps1
```

脚本下载并校验固定 Node 版本，在构建时执行 `npm ci`，测试及构建 Tauri，再生成 portable ZIP 和 SHA256。详细步骤见 [BUILD](docs/BUILD.md)。最终使用者不执行构建脚本。

## 文档

- [架构 ADR](docs/ADR-001-DESKTOP-ARCHITECTURE.md)
- [离线部署](docs/OFFLINE_DEPLOYMENT.md) / [运行前提](docs/RUNTIME_REQUIREMENTS.md)
- [离线审计](docs/OFFLINE_AUDIT.md) / [版本](docs/VERSIONS.md)
- [第三方许可](docs/THIRD_PARTY_LICENSES.md)
- [测试及验收状态](docs/TEST_REPORT.md)
