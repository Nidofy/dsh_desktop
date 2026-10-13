/** Stable T19 measurement identities and report-only diagnostic codes. */
export const checks = [
  ['node', 'local'], ['dsh', 'local'], ['modules', 'local'], ['webview', 'local'],
  ['storage', 'local'], ['shell', 'local'], ['skills', 'local'], ['action-trust', 'local'],
  ['action-run', 'local'], ['action-change', 'local'], ['cancel', 'local'], ['git', 'local'],
  ['hg', 'local'], ['artifact', 'local'], ['prefix', 'local'], ['recovery', 'local'],
  ['notification', 'local'], ['probe-failure', 'local'], ['connection', 'provider'],
  ['streaming', 'provider'], ['tool-call', 'provider'], ['cache-counter', 'provider'],
  ['cache-repeat', 'provider'], ['native-acceptance', 'field'], ['egress', 'field'],
] as const

/** Whitelist excludes paths, raw errors, endpoints, credentials and model text. */
export const codes = [
  'OK', 'NOT_SELECTED', 'FIELD_UNVERIFIED', 'CARRIER_UNVERIFIED', 'NOT_IMPLEMENTED',
  'DEPENDENCY_MISSING', 'ASSERTION_FAILED', 'EXECUTION_UNCONFIRMED', 'SOURCE_UNAVAILABLE',
  'CANCELLED', 'TIMEOUT', 'PROCESS_INTERRUPTED', 'STORAGE_FAILED', 'CLEANUP_FAILED',
  'REQUEST_BUDGET_EXHAUSTED', 'OUTPUT_BUDGET_EXHAUSTED', 'USAGE_UNREPORTED', 'CACHE_UNCONFIRMED',
  'PROVIDER_FAILED', 'TOOL_UNCONFIRMED', 'STREAM_UNCONFIRMED',
] as const
