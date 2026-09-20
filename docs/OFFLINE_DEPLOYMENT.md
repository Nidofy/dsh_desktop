# Offline deployment

1. Build and verify on the connected Windows build host.
2. Transfer the ZIP and SHA256SUMS through the company's approved channel.
3. Verify ZIP SHA256 before extracting; retain all resources and license files.
4. Extract the complete ZIP to a local directory owned by the current ordinary user, then run DSHDesktop.exe. Version 0.1.2 includes WebView2; no runtime installation or download is needed. Do not launch from inside the ZIP, a UNC/network share, or a protected installation directory. Windows 10 requires the program to grant AppContainer read/execute access to its own browser folder.
5. Select OpenAI Chat Completions or Anthropic Messages; set the internal Base URL, API Key and model list, then choose a workspace in native DSH. Anthropic accepts a root URL with or without a trailing `/v1`; the settings page previews the actual request URL.
6. Closing the main window hides it to the Windows notification area and keeps the engine running. Click the DSH Desktop tray icon to reopen; right-click it and choose Exit to stop the application before replacing files. Windows controls whether the icon is visible directly or inside the hidden-icons flyout.

The executable is portable; user state is deliberately outside the portable folder in `%LOCALAPPDATA%\DSHDesktop`. Moving the package does not delete sessions or credentials. Exit the application before replacing a package. Keep the old ZIP for rollback; upstream session-format compatibility must be checked before downgrading DSH.

The package starts an OS-assigned IPv4 loopback listener and exchanges the upstream one-time launch URL for its HttpOnly cookie. Do not share the launch URL or DSH authentication files. The desktop never includes the URL query or API key in logs/diagnostics.

Allowed intended network: the configured LLM Base URL, plus tools/MCP deliberately invoked by the user. No wrapper update service exists. Build scripts and smoke instruments are not shipped as startup actions. Arbitrary new npm plugin installation is outside offline V1; make a new complete build instead.

Before production use, run the remaining clean-image and UI cases in TEST_REPORT.md. The supplied ZIP is a candidate artifact, not an accepted enterprise deployment.
