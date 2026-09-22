import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, symlink} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {ProjectActions, validateActionConfig} from '../runtime-src/project-actions.mjs';
await mkdir('.build', {recursive: true});
const root = await mkdtemp(resolve('.build/actions-')), workspace = join(root, 'workspace'), other = join(root, 'other');
await mkdir(workspace); await mkdir(other); await mkdir(join(workspace, '.dsh'));
const config = {schemaVersion: 1, actions: [{id: 'test', label: 'Test', command: 'fixture', cwd: '.', timeoutMs: 1000}]};
await writeFile(join(workspace, '.dsh/project-actions.json'), JSON.stringify(config));
let active = 0, maxActive = 0, executions = 0, release, hold = false;
const executor = async action => {
  executions++; active++; maxActive = Math.max(active, maxActive);
  if (hold) await new Promise(resolve => { release = resolve; action.signal.addEventListener('abort', resolve, {once: true}); });
  active--;
  return {exitCode: action.signal.aborted ? null : 0, aborted: action.signal.aborted, timedOut: false, timeoutMs: 1000,
    stdout: {text: 'result for ' + action.command, truncated: false}, stderr: {text: '', truncated: false}, sandbox: {mode: 'workspace-write', denied: false}};
};
const service = new ProjectActions(join(root, 'home'), executor);
let view = await service.inspect(workspace);
assert.equal(view.source, 'project'); assert.equal(view.trusted, false);
await assert.rejects(service.start(workspace, 'test'), {code: 'TRUST_REQUIRED'});
await assert.rejects(service.trust(workspace, 'obsolete'), {code: 'CONFIG_CHANGED'});
await service.trust(workspace, view.fingerprint);
assert.equal((await service.inspect(workspace)).trusted, true);
// Model cannot provide an arbitrary command: only an approved, registered ID runs.
await assert.rejects(service.start(workspace, 'not-listed'), {code: 'ACTION_NOT_FOUND'});
const first = await service.start(workspace, 'test');
assert.equal((await service.wait(workspace, first.id)).status, 'PASS');
assert.match(await service.log(workspace, first.id), /result for fixture/);
await assert.rejects(service.log(other, first.id), {code: 'NOT_FOUND'});
await assert.rejects(service.log(workspace, '../../config'), {code: 'NOT_FOUND'});
// Editing a repository definition revokes trust without touching the host trust store.
await writeFile(join(workspace, '.dsh/project-actions.json'), JSON.stringify({...config, actions: [{...config.actions[0], command: 'changed'}]}));
assert.equal((await service.inspect(workspace)).trusted, false);
view = await service.save(workspace, config); assert.equal(view.source, 'desktop');
await service.trust(workspace, view.fingerprint);
// Shared lane, cancellation while queued, trust revalidation when leaving the queue.
hold = true;
const running = await service.start(workspace, 'test');
while (!release) await new Promise(r => setTimeout(r, 10));
const queued = await service.start(workspace, 'test');
await service.cancel(workspace, queued.id);
assert.equal((await service.wait(workspace, queued.id)).status, 'CANCELLED');
assert.equal(active, 1, 'queued cancellation does not terminate the preceding action');
const changed = await service.start(workspace, 'test');
await service.revoke(workspace); hold = false; release();
assert.equal((await service.wait(workspace, running.id)).status, 'PASS');
assert.equal((await service.wait(workspace, changed.id)).status, 'NOT_STARTED');
assert.equal(maxActive, 1); assert.equal(executions, 2);
view = await service.inspect(workspace); await service.trust(workspace, view.fingerprint);
// Resolving a linked cwd must not escape the approved workspace.
await symlink(other, join(workspace, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
view = await service.save(workspace, {...config, actions: [{...config.actions[0], cwd: 'outside'}]});
await service.trust(workspace, view.fingerprint);
const escaped = await service.start(workspace, 'test');
assert.equal((await service.wait(workspace, escaped.id)).status, 'NOT_STARTED'); assert.equal(executions, 2);
view = await service.save(workspace, config); await service.trust(workspace, view.fingerprint);
// The same workspace reached through an alias shares its queue and trust.
await symlink(workspace, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
assert.equal((await service.inspect(join(root, 'alias'))).fingerprint, view.fingerprint);
hold = true; release = undefined;
const cancelled = await service.start(workspace, 'test');
while (!release) await new Promise(r => setTimeout(r, 10));
await service.close(); assert.equal((await service.wait(workspace, cancelled.id)).status, 'CANCELLED');
await assert.rejects(service.start(workspace, 'test'), {code: 'STOPPING'});
// A durable RUNNING record after an unclean exit is uncertain, never rerun automatically.
const stateDir = (await service.workspace(workspace)).dir;
const file = join(stateDir, 'runs', first.id + '.json');
const record = JSON.parse(await readFile(file)); record.status = 'RUNNING'; await writeFile(file, JSON.stringify(record));
const recovered = new ProjectActions(join(root, 'home'), () => assert.fail('recovery must not execute'));
assert.equal((await recovered.inspect(workspace)).runs.find(row => row.id === first.id).status, 'INTERRUPTED');
assert.equal(JSON.parse(await readFile(file)).status, 'INTERRUPTED');
await recovered.close();
for (const patch of [{id: '../bad'}, {cwd: '../other'}, {timeoutMs: 0}, {env: {DSH_DESKTOP_LLM_KEY: 'bad'}}, {command: ''}])
  assert.throws(() => validateActionConfig({...config, actions: [{...config.actions[0], ...patch}]}));
assert.throws(() => validateActionConfig({...config, actions: [config.actions[0], config.actions[0]]}));
// Retention really removes older logs and durable records after completion.
const retain = new ProjectActions(join(root, 'retention'), executor); hold = false;
view = await retain.save(workspace, config); await retain.trust(workspace, view.fingerprint);
for (let i = 0; i < 103; i++) { const row = await retain.start(workspace, 'test'); await retain.wait(workspace, row.id); }
assert.equal((await retain.inspect(workspace)).runs.length, 100);
const retainedDir = join(root, 'retention', 'desktop-actions', (await readdir(join(root, 'retention', 'desktop-actions')))[0], 'runs');
assert.equal((await readdir(retainedDir)).length, 200);
await retain.close();
console.log('PASS project actions: trust changes, shared queue, cancellation, cwd escape, persistent interruption, retention');
console.log('Evidence workspace:', root);
