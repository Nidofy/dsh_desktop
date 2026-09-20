# Third-party redistribution inventory

This build preserves the full npm production tree and its included license files. `scripts/license-inventory.mjs` copies root LICENSE/COPYING/NOTICE/THIRD_PARTY files into the package `licenses/` directory and generates package/version/license inventories. Cargo metadata supplies the pinned Rust package inventory, including build dependencies for transparency.

| Component | Recorded license / location |
|---|---|
| Official Node 24.16.0 | Official tag LICENSE (Node MIT plus bundled third-party notices), resources/runtime/LICENSE |
| Official @deepseek-ai/dsh and its packages | Published package metadata and individual included license texts; DSH is MIT |
| Tauri | MIT OR Apache-2.0; original Rust crate license texts copied |
| npm transitive/native packages | npm-license-inventory.json plus original package trees and licenses/ |
| Rust crates | rust-license-inventory.json plus licenses/rust_* |
| WebView2 Fixed Version 153.0.4234.48 x64 | Microsoft Fixed Version license in licenses/WebView2-Fixed-Version.html; complete unmodified official browser tree in resources/webview2 |

The application icon and wallpaper originate from the user's supplied artwork. The wallpaper's white background was removed with the built-in imagegen tool. scripts/make-icon.mjs converts these local assets for packaging; it does not generate new artwork. No reference-project icon/code was copied. Reference repositories are investigation material and are not included in the portable package.

Actual candidate inventory: 518 npm packages and 262 Rust packages. No missing/UNLICENSED declarations were found by the inventory check. `@img/sharp-win32-x64@0.35.4` declares `Apache-2.0 AND LGPL-3.0-or-later`; its redistribution obligations require release review.

The full dependency tree contains native libraries with licenses beyond MIT/Apache, including sharp/libvips-related packages. Preserve their copyright/notices and review any LGPL source/relinking obligations before corporate redistribution. Upstream source projects include [Node](https://github.com/nodejs/node/tree/v24.16.0), [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), [sharp](https://github.com/lovell/sharp), and [libvips](https://github.com/libvips/libvips). The machine inventory is evidence of declared licenses, not a claim that all legal obligations have been independently cleared.

Release review must check missing/unrecognized license declarations and binary-specific notices against the actual ZIP. The clean-image/legal release review remains separate from functional smoke testing.
