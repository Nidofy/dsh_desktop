import {diagnosticState} from './diagnostic-state.mjs';
// Repair a removed desktop model through DSH's public selection API, preserving history.
export const name = 'desktop-model-defaults';
export const inject = ['agents', 'sessionController', 'sessionProjections'];
export function apply(ctx, config) {
  ctx.on('agent/created', async ({agent}) => {
    // Prompt admission checks the route before agent/request. Repair a retired
    // desktop selection as the cold session is resumed, using the public API.
    const pending=ctx.sessionProjections.stateOf(agent.session,'modelSelection')?.pending;
    const selection=pending??agent.session.requestHeader()?.config;
    if(selection && diagnosticState.retiredManagedProviders?.includes(selection.provider)){
      await ctx.sessionController.selectModel({sessionId:agent.session.id,provider:config.provider??'desktop-internal',model:config.models?.includes(selection.model)?selection.model:config.defaultModel});
    }
    agent.ctx.on('agent/request', async (_payload, next) => {
      let request = await next();
      const provider=config.provider??'desktop-internal';
      if ((request.provider===provider && !config.models?.includes(request.model)) || diagnosticState.retiredManagedProviders?.includes(request.provider)) {
        const plain = request.model.replace(/\[1m\]$/i, '');
        request = {...request, provider, model:config.models?.includes(plain) ? plain : config.defaultModel};
        const effort = request.reasoningEffort;
        await ctx.sessionController.selectModel({sessionId:agent.session.id,provider:request.provider,model:request.model,
          ...(effort ? {reasoningEffort:effort} : {})});
      }
      return request;
    }, {prepend:true});
  });
}
