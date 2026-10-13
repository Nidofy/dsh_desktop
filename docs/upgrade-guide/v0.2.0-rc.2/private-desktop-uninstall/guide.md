---
kind: upgrade-guide
description: Private Windows Desktop uninstallers retain application data and caches instead of deleting them.
---

# Private Windows Desktop uninstall preserves data

English | [中文](guide.zh.md)

## Change

Personal and Intranet Windows Desktop uninstallers now retain their product data directory, Electron package data and updater cache. Earlier private installers inherited the upstream cleanup policy, which could remove the default private Harness home inside the product directory. This change does not modify the upstream distribution's cleanup policy or persisted formats.

## Migration

1. Keep the existing private data root and an independent backup before changing an installation. The defaults are `%APPDATA%\Nidofy DSH Desktop` and `%APPDATA%\Nidofy DSH Intranet`; preserve an explicit `--nidofy-desktop-data-root` or `NIDOFY_DESKTOP_DATA_ROOT` separately.
2. Use a newly built private installer with the retention policy. Do not run an older private uninstaller to remove data. Production-identity installation and old-installation replacement still require qualification in a clean account or VM; internal unsigned candidates are not release-qualified.
3. After uninstalling the newly installed version, confirm the application installation is removed and the private data root remains. Uninstall no longer resets private settings or erases sessions; any later data removal must be a separate deliberate operation. See the [Desktop installation contract](../../../../apps/desktop/README.md) for the current behavior.
