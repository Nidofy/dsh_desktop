# Runtime requirements — Desktop 0.1.2

- Windows 10/11 x64, ordinary non-administrator account; writable `%LOCALAPPDATA%` and chosen workspace.
- **No preinstalled WebView2 is required.** The complete Microsoft WebView2 Fixed Version 153.0.4234.48 x64 is included under `resources/webview2`.
- Extract the entire ZIP to a local directory owned by the current user. Do not run from inside the ZIP, a UNC/network share, or a protected Program Files directory.
- No system Node/npm/pnpm/Rust/build tools are required by the wrapper. Bundled executable paths are mandatory; no system Node or Evergreen fallback.
- Native DSH's PowerShell tool still relies on Windows PowerShell supplied by Windows. Project-specific commands need that project's own toolchain.
- Enterprise application policy must allow the application, bundled Microsoft-signed browser binaries, Node and DSH's restricted-token runner. No installer, service, registry changes or UAC elevation is used.

## Windows 10 sandbox access

Microsoft requires Fixed Version 120+ unpackaged Win32 apps on Windows 10 to grant the two AppContainer groups read/execute access to the browser directory. Before creating any window, 0.1.2 invokes the system icacls executable against **only resources/webview2**, granting `S-1-15-2-1` and `S-1-15-2-2` inherited RX rights. No write permission is granted and the browser sandbox remains enabled. An ordinary user can do this in their own extracted directory. If that directory is protected or enterprise policy prevents it, a native Chinese error explains how to move the complete package to a user-owned local directory. Windows 11 does not need this ACL adjustment.

Startup explicitly sets the current-process browser path before Tauri's runtime detection. It verifies required browser files and the pinned version. Missing or broken resources produce a native message box and `%LOCALAPPDATA%/DSHDesktop/logs/desktop.log`, even when no browser can start. Diagnostics report the browser path/version and the actual Windows build.

## Distribution and updates

The browser is the official unmodified Fixed Version CAB from Microsoft's download page, not a copy of an installed Evergreen/Edge browser. Build scripts verify the pinned CAB hash, Microsoft signature, version, and all 257 extracted file hashes. This adds 699,773,121 bytes of browser files before ZIP compression. Its Microsoft license and original third-party notices are included. See `licenses/WebView2-Fixed-Version.html`.

Fixed Version does not automatically update itself. Browser security refreshes require a new tested portable package. Browser/OS-wide network behavior and the target corporate image still require acceptance testing; bundling is not evidence of system-wide network silence. The build host runs Windows 11; a native Windows 10 target run must not be claimed from Windows 11 tests.

Sources: [Microsoft distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [Evergreen vs Fixed Version](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version), and [official Fixed Version license](https://developer.microsoft.com/microsoft-edge/api/eula/webview2?fixed=true).