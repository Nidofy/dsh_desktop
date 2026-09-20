# Desktop 0.1.3 — protocols, models and notification area

The desktop connection editor now selects OpenAI Chat Completions (`openai-completions`) or Anthropic Messages (`anthropic-messages`). It passes the selected native protocol to the existing DSH pi-ai adapter; no upstream provider code changes are required.

Each connection accepts 1–100 unique model IDs sharing its Base URL and credential. Add/remove rows and choose the initial default model. All entries appear in DSH's native model catalog; session model switching and subsequent selection persistence stay with DSH. Existing single-model `connection.json` files load as an OpenAI connection and retain their original model and Credential Manager entry. Empty/duplicate models, unsupported protocols and defaults outside the list are rejected before credentials or configuration are written.

OpenAI uses the supplied base plus `/chat/completions`. Anthropic uses the API root plus `/v1/messages`; a final `/v1` is normalized when generating the provider overlay, retaining any gateway path prefix. Stored Base URL and credential target remain unchanged. The page previews the request URL so users can check the endpoint before saving. API keys are never returned to the editor or included in either JSON file.

The notification-area icon uses the existing application artwork. Clicking the icon restores/unminimizes the main window (or settings during startup). Its right-click menu provides Open, Settings / Diagnostics, Restart Engine and Exit. Main-window close now hides both main and companion settings windows; settings-window close hides only settings. The backend, sessions and process Job remain alive. Explicit Exit/Quit follows the existing bounded graceful shutdown and Job cleanup. Failure to create the tray aborts startup rather than leaving an unrecoverable hidden app. Windows decides whether the icon sits directly in the notification area or its overflow flyout; no system preference is changed.

## Validation

- Eight Rust release tests passed, covering legacy config decoding, native overlay generation for both protocols, model-list validation, credentials, URL validation, browser preflight/ACL and child-process cleanup.
- `tests/protocol-models.mjs` consumes production overlays emitted by the Rust test. On both local mock protocols, it verifies model catalog/default, actual authentication headers, prefixed request path, streaming completion, a real native file-read tool round trip, model switching on the wire, and persisted selection after backend restart. See `evidence/protocol-models-0.1.3.json`.
- Native settings testing loaded a legacy configuration, selected Anthropic, added a second model, made it default and saved/restarted successfully. The saved configuration and generated overlay retained both models and no plaintext credential.
- Native main-window close hid both windows while desktop PID 7780 and backend PID 16964 remained alive. The matching icon appeared in the Windows hidden-icons flyout; clicking it restored the same main window. All four right-click menu actions were visually present.
- Existing full native runtime smoke and all four negative API cases passed in the new portable package. Evidence files are named `feature013-runtime.json` and `feature013-api-negative.json`.
- A fresh extraction of the actual ZIP passed all 257 browser hashes and the non-admin desktop process test: bundled browser, loopback-only listener, second-instance rejection, crash supervision and cleanup. See `evidence/feature013-extracted-desktop.json`.
- Direct automation of the tray menu's Exit item could not be completed reliably while desktop focus changed. Its callback uses the unchanged explicit quit path; the specific native menu click is still a manual acceptance item. GUI evidence is summarized in `evidence/feature013-gui.json`.

Checks were performed on Windows 11 build 26200 with an ordinary user. Clean Windows 10/company-image validation and system-wide network isolation remain pending.

Protocol references: [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create). Exact adapter behavior was checked against the bundled `@deepseek-ai/dsh-llm-pi-ai` package.
