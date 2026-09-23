// Local capability checks only. Never probes a provider or reads session content.
import {diagnosticState} from './diagnostic-state.mjs';
export const desktopContractVersion = 1;
export function desktopHealth(ctx, {actions = 'starting', snapshotBridge = false} = {}) {
  const services = {};
  for (const name of ['llm','agents','sessionQuery','sessionProjections','shell','sandboxPolicy']) {
    try { services[name] = !!ctx.get(name); } catch { services[name] = false; }
  }
  return {contractVersion:desktopContractVersion,engineVersion:diagnosticState.engineVersion??'0.1.5-rc.2',
    coreReady:Object.values(services).every(Boolean),services,
    capabilities:{projectActions:actions,snapshotBridge:snapshotBridge?'connected':'disabled'}};
}
