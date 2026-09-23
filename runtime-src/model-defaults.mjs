import {diagnosticState} from './diagnostic-state.mjs';
// Repair a removed desktop model through DSH's public selection API, preserving history.
export const name = 'desktop-model-defaults';
export const inject = ['agents', 'sessionController', 'sessionProjections'];
export function apply(ctx, config) {
  const current=()=>diagnosticState.managedModels??config;
  ctx.on('agent/created', async ({agent}) => {
    // Prompt admission checks the route before agent/request. Repair a retired
    // desktop selection as the cold session is resumed, using the public API.
    const pending=ctx.sessionProjections.stateOf(agent.session,'modelSelection')?.pending;
    const selection=pending??agent.session.requestHeader()?.config;
    const live=current(),route=live.provider??'desktop-internal';
    if(selection && (diagnosticState.retiredManagedProviders?.includes(selection.provider)||(selection.provider===route&&!live.models?.includes(selection.model)))){
      const plain=selection.model?.replace(/\[1m\]$/i,'');
      await ctx.sessionController.selectModel({sessionId:agent.session.id,provider:route,model:live.models?.includes(plain)?plain:live.defaultModel,
        ...(selection.reasoningEffort?{reasoningEffort:selection.reasoningEffort}:{})});
    }
    agent.ctx.on('agent/request', async (_payload, next) => {
      let request = await next();
      const live=current(),provider=live.provider??'desktop-internal';
      if ((request.provider===provider && !live.models?.includes(request.model)) || diagnosticState.retiredManagedProviders?.includes(request.provider)) {
        const plain = request.model.replace(/\[1m\]$/i, '');
        request = {...request, provider, model:live.models?.includes(plain) ? plain : live.defaultModel};
        const effort = request.reasoningEffort;
        await ctx.sessionController.selectModel({sessionId:agent.session.id,provider:request.provider,model:request.model,
          ...(effort ? {reasoningEffort:effort} : {})});
      }
      return request;
    }, {prepend:true});
  });
}
