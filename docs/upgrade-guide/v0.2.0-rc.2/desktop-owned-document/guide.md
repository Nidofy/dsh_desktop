---
kind: upgrade-guide
description: "Desktop bootstrap rejects unowned complete application windows and stale documents."
---

# Desktop bootstrap requires the owned application document

English | [中文](guide.zh.md)

## Change

Desktop boot IPC previously accepted other `dsh-app://app` pages, although their locale and Host streams were refused. Boot and locale now require the current top document at `/` or `/index.html` in Main's primary window. Reload or destruction invalidates pending reads. Application WebSocket requests to unavailable or replaced Host addresses are cancelled, including requests carrying previous cookies. Primary-only product IPC retains its existing owners.

## Migration

1. Use the existing Main-created Conversation window. Do not create a second complete root to obtain boot injections or connect a Host stream. Workbench and other auxiliary pages keep their existing HTTP and scoped navigation paths.
2. After reloading the primary window, use its fresh boot and Companion scope. Do not reuse a previous document's scope or Host address.
3. Confirm that the primary Conversation reconnects and its workbench opens. An independently created full root must reject boot and locale with `DESKTOP_APPLICATION_DOCUMENT_REFUSED` and must not establish the Host stream. No persisted data conversion is required.
