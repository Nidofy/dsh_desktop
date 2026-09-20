# Desktop 0.1.1 appearance update

The official bundled engine remains **@deepseek-ai/dsh 0.1.5-rc.2**. The first-run welcome notice's Chinese copy says “目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段”. This refers to the 0.1 release series, not the exact patch version or a failed update. The copy is shipped in `@deepseek-ai/dsh-client-ui-settings-models/lib/client.js` (`welcomeBody`). Its acknowledgement uses the `ui-onboarding` settings namespace and `welcomeNoticeVersion` field, currently `2026-08-13.1`. This update preserves the official welcome flow.

User attachment 1 is preserved in `assets/icon-source.png`. `scripts/make-icon.mjs` packages it as a Windows ICO with 16, 24, 32, 48, 64, 128 and 256 pixel images, the Tauri default window icon, and the settings-page icon.

User attachment 2 was edited with the built-in imagegen tool (edit mode, one reference image) to remove the external white background. The generated transparent master is `assets/wallpaper-transparent.png`. Prompt: “Remove only the external white background; preserve the complete square composition, blue-haired maid holding a rice bowl, small whale, yellow decorations, ground shadow, exact Chinese headline 我是吃白饭的大肥鱼！, colors, outlines and opaque white regions inside clothing, rice, bowl and lettering. Produce genuine PNG alpha transparency; leave the foreground opaque, with overall opacity handled by the app.” Generative editing may introduce small detail differences from the reference.

The build converts these local assets and embeds the wallpaper in the executable. `desktop-theme/inject.js` installs a desktop-only stylesheet for DSH's conversation root (`data-phase`: blank/hero/settling/active). A contained, noninteractive pseudo-element at 14% opacity stays behind content. It also follows resizing and session changes without altering the upstream npm packages. The local settings page uses the same art. Windows forced-colors mode hides decorative backgrounds. No image URLs, downloads or runtime image-processing dependencies are added.

Run the normal `scripts/build-windows.ps1` workflow to regenerate all assets before Cargo compilation. A developer invoking Cargo directly must first run `node scripts/make-icon.mjs` with the prepared runtime present. The generated theme script is build output; the source artwork and injection template are the reproducible inputs.

Desktop version 0.1.1 identifies this appearance update; engine and runtime versions are unchanged. All existing clean-image and full lifecycle acceptance limitations remain applicable.

## Verification on 2026-09-20

- Release build and all four existing Rust tests passed. Windows EXE resources report 0.1.1; extracting the embedded icon reproduces attachment 1.
- The generated wallpaper has a real alpha channel (minimum 0, maximum 255), not a painted checkerboard.
- The packaged runtime smoke and all four negative API cases passed again. Reports are in `evidence/appearance-runtime.json` and `evidence/appearance-api-negative.json`.
- Actual native WebView windows were inspected with computer-use: title-bar icon, settings-page icon, settings background, welcome notice, and the unobscured native conversation screen. See `evidence/appearance-0.1.1.png`.
- Clicking Continue on the official welcome notice persisted its acknowledgement. Restarting the final packaged EXE with the same isolated profile did **not** show the 0.1 notice again. The separate model-key onboarding still appears when no model is configured, as expected.
- Closing the native main window stopped the desktop and backend; the supervisor logged its Job cleanup. These checks used a project-local test profile, leaving the user's saved connections and sessions untouched.
- The old portable directory was preserved as `dist/DSHDesktop-win-x64-portable-0.1.0-backup`. The canonical `dist/DSHDesktop-win-x64-portable` directory now contains 0.1.1.

## Explorer folder icons

Version 0.1.2 preserves the same icon and transparent wallpaper while bundling WebView2. The previous 0.1.1 directory is retained as a backup. Repeated application of the folder icon now supports an existing hidden/system `desktop.ini` without a write error.

The portable directory includes `DSHDesktop.ico` from the same seven-size icon master and a Unicode `desktop.ini` with a relative icon path. The folder read-only attribute enables the customization without changing file permissions. Packaging explicitly adds the hidden configuration and DOS attributes to the ZIP because Compress-Archive skips hidden files. Extractors that discard Windows attributes may show a normal folder icon; the EXE's embedded icon is independent of this. The build-time script `scripts/set-folder-icon.ps1` can reapply the attributes and optionally notify Explorer to refresh cached icons. The current development EXE was also synchronized to 0.1.1; the previous development EXE was preserved under `.build/icon-backup`.

Implementation follows Microsoft's [folder customization](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-customize-folders-with-desktop-ini) and [Shell change notification](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify) documentation. No file associations, registry settings or Explorer processes are changed.
