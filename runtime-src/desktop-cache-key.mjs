import {createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import {diagnosticState} from './diagnostic-state.mjs';

export const CACHE_KEY_BRIDGE_VERSION = 1;
// Captured when the prepared adapter stream is constructed. No request-time
// environment changes, timestamps or conversation content enter this scope.
export function desktopCacheKeyOptions(profile, model, options, state = diagnosticState) {
  const policy = profile.desktopCacheKey;
  if (profile.provider !== (state.managedProvider ?? 'desktop-internal') || profile.api !== 'openai-completions'
      || !policy || policy.mode === 'native') return {};
  if (!['off','session'].includes(policy.mode)) throw Error('DESKTOP_CACHE_KEY_POLICY_INVALID');
  const allowed = policy.mode === 'session' && Array.isArray(policy.models) && policy.models.includes(model.id);
  const session = options.sessionId;
  let key;
  if (allowed && session !== undefined && session !== null && String(session).length) {
    if (!state.home || !Buffer.isBuffer(state.key) || state.key.length !== 32) throw Error('DESKTOP_CACHE_KEY_SCOPE_UNAVAILABLE');
    const home = resolve(state.home);
    const scope = [CACHE_KEY_BRIDGE_VERSION, process.platform === 'win32' ? home.toLowerCase() : home,
      profile.provider, profile.api, profile.baseURL, model.id, String(session)];
    key = 'dsh_' + createHmac('sha256',state.key).update('desktop-prompt-cache-key-v1\0').update(JSON.stringify(scope)).digest('base64url');
  }
  return {onPayload(payload) {
    // pi-ai constructs the wire object. Preserve every field other than this
    // independently controlled routing hint, including native cache markers.
    const result = {...payload};
    delete result.prompt_cache_key;
    if (key !== undefined) result.prompt_cache_key = key;
    return result;
  }};
}
