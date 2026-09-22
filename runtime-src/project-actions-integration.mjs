import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ProjectActions, ActionError} from './project-actions.mjs';
import {StorageAdmissionError} from './storage-admission.mjs';
import {actionsHtml, actionsScript} from './project-actions-page.mjs';

export function nativeActionExecutor(ctx) {
  return async action => {
    const shell = ctx.get('shell'), policies = ctx.get('sandboxPolicy');
    if (!shell || !policies) throw new ActionError('UNAVAILABLE', 'DSH 命令执行服务尚未就绪');
    const exec = action.context;
    // Re-resolve when leaving the queue: later permission changes must take effect.
    const sandboxPolicy = exec?.agent ? policies.resolve({session: exec.agent.session}) : {mode: 'workspace-write', workspaceRoot: action.workspace};
    const dshEnv = exec && ctx.get('shellEnv') ? ctx.get('shellEnv').collect(exec) : undefined;
    try {
      return await shell.run(shell.resolve({command: action.command, workdir: action.cwd, env: action.env,
        timeoutMs: action.timeoutMs, stdoutMaxBytes: 512 * 1024, signal: action.signal, sandboxPolicy, dshEnv}));
    } catch (error) {
      // This is a local execution record, separate from metadata-only diagnostic exports.
      throw new ActionError('SHELL_FAILED', 'DSH 执行失败：' + String(error.message ?? error).slice(0,2000));
    }
  };
}
export async function installProjectActions(ctx, home) {
  const manager = new ProjectActions(home, nativeActionExecutor(ctx));
  ctx.effect(() => () => manager.close());
  const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), 'dsh/package.json'));
  const {defineTool} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
  ctx.inject(['tools'], scope => {
    const workspace = exec => {
      const cwd = exec.agent?.session.header.cwd;
      if (!cwd) throw new ActionError('NO_WORKSPACE', '当前工具调用没有关联工作区');
      return cwd;
    };
    const output = {schema: {type: 'object', additionalProperties: true}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]};
    scope.tools.register(defineTool({name: 'list_project_actions', description: 'List configured build/test actions for this workspace and whether the exact configuration is trusted. Action commands can only be approved in the desktop Project Actions page.', parameters: {}, output,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const view = await manager.inspect(workspace(exec));
        return {trusted: view.trusted, actions: view.config.actions.map(({id, label, timeoutMs}) => ({id, label, timeoutMs})), instructions: view.trusted ? 'Run an action by its ID.' : 'Ask the user to review and trust the configuration in Help > Session Diagnostics > Project Actions.'};
      }}));
    scope.tools.register(defineTool({name: 'run_project_action', description: 'Run a user-trusted project action by ID, using current session sandbox permissions. Serializes actions in the same workspace; returns exit status and bounded log tail. Never automatically rerun an interrupted action with unknown side effects.', parameters: {id: {type: 'string', required: true}}, output,
      async execute(args, exec) {
        const cwd = workspace(exec), run = await manager.start(cwd, args.id, {signal: exec.signal, context: exec, source: 'agent'});
        return manager.wait(cwd, run.id);
      }}));
  });
  return {manager, async handle(req, res, url) {
    const json = (code, data) => res.writeHead(code, {'content-type': 'application/json; charset=utf-8'}).end(JSON.stringify(data));
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/desktop-diagnostics/actions') { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(actionsHtml); return; }
        if (url.pathname === '/desktop-diagnostics/actions.js') { res.writeHead(200, {'content-type': 'text/javascript; charset=utf-8'}).end(actionsScript); return; }
        if (url.pathname === '/desktop-diagnostics/api/actions/inspect') { json(200, await manager.inspect(url.searchParams.get('workspace'))); return; }
        if (url.pathname === '/desktop-diagnostics/api/actions/log') { json(200, {text: await manager.log(url.searchParams.get('workspace'), url.searchParams.get('id'))}); return; }
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') { json(403, {error: '需要同源 JSON 请求'}); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 140 * 1024) { json(413, {error: '请求过大'}); return; } chunks.push(chunk); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        switch (url.pathname) {
          case '/desktop-diagnostics/api/actions/save': json(200, await manager.save(data.workspace, data.config)); return;
          case '/desktop-diagnostics/api/actions/trust': json(200, await manager.trust(data.workspace, data.fingerprint)); return;
          case '/desktop-diagnostics/api/actions/revoke': json(200, await manager.revoke(data.workspace)); return;
          case '/desktop-diagnostics/api/actions/start': json(200, await manager.start(data.workspace, data.id)); return;
          case '/desktop-diagnostics/api/actions/cancel': json(200, await manager.cancel(data.workspace, data.id)); return;
        }
      }
      json(404, {error: '入口不存在'});
    } catch (error) {
      const known=error instanceof ActionError||error instanceof StorageAdmissionError;
      json(known ? 400 : 500, {error: known ? error.message : '操作失败，请检查工作区路径、配置格式与存储权限', code: known ? error.code : 'LOCAL_ERROR'});
    }
  }};
}
