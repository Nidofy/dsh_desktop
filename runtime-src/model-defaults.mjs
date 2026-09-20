// Repair a removed desktop model through DSH's public selection API, preserving history.
export const name = 'desktop-model-defaults';
export const inject = ['agents', 'sessionController'];
export function apply(ctx, config) {
  ctx.on('agent/created', ({agent}) => {
    agent.ctx.on('agent/request', async (_payload, next) => {
      let request = await next();
      if (request.provider === 'desktop-internal' && !config.models?.includes(request.model)) {
        const plain = request.model.replace(/\[1m\]$/i, '');
        request = {...request, model:config.models?.includes(plain) ? plain : config.defaultModel};
        const effort = request.reasoningEffort;
        await ctx.sessionController.selectModel({sessionId:agent.session.id,provider:request.provider,model:request.model,
          ...(effort ? {reasoningEffort:effort} : {})});
      }
      return request;
    }, {prepend:true});
  });
}
