import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, realpath, lstat, open, rename, unlink} from 'node:fs/promises';
import {storageAdmission} from './storage-admission.mjs';
import {join, resolve, relative, isAbsolute} from 'node:path';
// Kept independent of the artifact service to avoid a storage dependency cycle.
const validArtifact = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !isAbsolute(value) && !/[\\:\0]/.test(value) && !value.split('/').some(p => !p || p === '.' || p === '..' || ['.git','.hg'].includes(p.toLowerCase()));

const ACTIVE = new Set(['QUEUED', 'RUNNING']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const RUN_ID = /^[a-f0-9-]{36}$/;
const MAX_CONFIG = 128 * 1024;
const MAX_LOG = 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const within = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && rel !== '..' && !isAbsolute(rel)); };
function verificationSpec(value) {
  if (value === undefined) return undefined;
  if (!value || value.schemaVersion !== 1 || !['complete','unknown'].includes(value.coverage)
    || ![null,'node-tap-13/1'].includes(value.parser)) fail('INVALID_CONFIG','验证范围版本、覆盖声明或解析器无效');
  const paths = (items, external) => {
    if (!Array.isArray(items) || items.length > 64 || items.some(p => typeof p !== 'string' || !p || p.length > 4096
      || p.includes('\0') || (!external && p !== '.' && !validArtifact(p)) || p.split(/[\\/]/).includes('..')))
      fail('INVALID_CONFIG','验证输入必须为明确的文件或目录；工具链可使用绝对路径');
    return [...new Set(items)].sort();
  };
  const parameters = {};
  if (value.parameters !== undefined && (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)))
    fail('INVALID_CONFIG','验证算例与容差必须为标量对象');
  for (const [key,val] of Object.entries(value.parameters ?? {}).sort(([a],[b])=>a.localeCompare(b))) {
    if (!ID.test(key) || !(typeof val === 'string' && val.length <= 1024 || typeof val === 'number' && Number.isFinite(val)
      || typeof val === 'boolean' || val === null)) fail('INVALID_CONFIG','验证算例与容差无效');
    parameters[key] = val;
  }
  if (Object.keys(parameters).length > 64) fail('INVALID_CONFIG','验证参数过多');
  return {schemaVersion:1, intent:string(value.intent,1024,'验证意图'), parser:value.parser, coverage:value.coverage,
    sources:paths(value.sources,false), inputs:paths(value.inputs,false), toolchain:paths(value.toolchain,true), parameters};
}
export class ActionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new ActionError(code, message); }
function string(value, max, label, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || value.includes('\0')) fail('INVALID_CONFIG', `${label} 无效`);
  return value;
}
export function validateActionConfig(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.actions) || value.actions.length > 40) fail('INVALID_CONFIG', '需要 schemaVersion: 1，最多 40 个操作');
  const ids = new Set();
  const actions = value.actions.map(action => {
    if (!action || !ID.test(action.id) || ids.has(action.id)) fail('INVALID_CONFIG', '操作 ID 无效或重复');
    ids.add(action.id);
    const cwd = action.cwd ?? '.';
    if (typeof cwd !== 'string' || isAbsolute(cwd) || cwd.split(/[\\/]/).includes('..') || cwd.includes(':')) fail('INVALID_CONFIG', '操作目录必须位于工作区内');
    const timeoutMs = action.timeoutMs ?? 600000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 7200000) fail('INVALID_CONFIG', '超时范围为 1 秒至 2 小时');
    if (action.env !== undefined && (!action.env || Array.isArray(action.env) || typeof action.env !== 'object')) fail('INVALID_CONFIG', '环境变量格式无效');
    const env = {};
    for (const [key, val] of Object.entries(action.env ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key) || /^(DSH_|NODE_OPTIONS$|NODE_PATH$)/i.test(key)) fail('INVALID_CONFIG', '不允许覆盖运行时管理的环境变量');
      env[key] = string(val, 4096, '环境变量', true);
    }
    if (Object.keys(env).length > 64) fail('INVALID_CONFIG', '环境变量数量过多');
    if (action.artifacts !== undefined && (!Array.isArray(action.artifacts) || action.artifacts.length > 20 || action.artifacts.some(path => !validArtifact(path)))) fail('INVALID_CONFIG', '产物需为最多 20 个工作区相对文件路径');
    if(action.commands !== undefined && (!action.commands || Array.isArray(action.commands) || typeof action.commands !== 'object' || Object.keys(action.commands).some(key=>!['win32','darwin','linux'].includes(key)))) fail('INVALID_CONFIG','平台命令格式无效');
    const commands=action.commands === undefined ? undefined : Object.fromEntries(Object.entries(action.commands).map(([key,value])=>[key,string(value,16000,'平台命令')]));
    const command=commands?.[process.platform] ?? (commands === undefined ? action.command : undefined);
    if(command === undefined) fail('PLATFORM_UNSUPPORTED','当前平台没有配置命令');
    const verification = verificationSpec(action.verification);
    return {id: action.id, label: string(action.label, 120, '名称'), command: string(command, 16000, '命令'), ...(commands ? {commands} : {}), cwd: string(cwd, 1024, '工作目录'), timeoutMs, env, ...(action.artifacts?.length ? {artifacts:[...new Set(action.artifacts)]} : {}), ...(verification ? {verification} : {})};
  });
  const config = {schemaVersion: 1, actions};
  if (Buffer.byteLength(JSON.stringify(config)) > MAX_CONFIG) fail('INVALID_CONFIG', '操作配置过大');
  return config;
}
async function readJson(path, maxBytes = MAX_CONFIG) {
  const file = await open(path, 'r');
  try {
    if ((await file.stat()).size > maxBytes) fail('INVALID_STORAGE', '本地文件超过读取上限');
    const buffer = Buffer.alloc(maxBytes + 1); let offset = 0;
    while (offset < buffer.length) { const {bytesRead} = await file.read(buffer, offset, buffer.length - offset); if (!bytesRead) break; offset += bytesRead; }
    if (offset > maxBytes) fail('INVALID_STORAGE', '本地文件超过读取上限');
    return JSON.parse(buffer.subarray(0, offset).toString('utf8'));
  } finally { await file.close(); }
}
async function optionalJson(path) {
  try { return await readJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function writeAtomic(path, value) {
  return storageAdmission.write(path,Math.max(1,Buffer.byteLength(value)*2),async()=>{
  const temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  try { await rename(temporary, path); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  });
}

/** Host-owned configuration/trust and bounded action journal. No provider requests. */
export class ProjectActions {
  constructor(home, execute, hooks) {
    this.home = join(home, 'desktop-actions');
    this.execute = execute;
    this.hooks = hooks;
    this.states = new Map();
    this.jobs = new Map();
    this.closed = false;
  }
  async workspace(path) {
    if (typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_WORKSPACE', '请输入绝对工作区路径');
    const root = await realpath(path);
    if (!(await lstat(root)).isDirectory()) fail('INVALID_WORKSPACE', '工作区不是目录');
    const key = digest(process.platform === 'win32' ? root.toLowerCase() : root);
    if (!this.states.has(key)) {
      if (this.states.size >= 64) fail('LIMIT', '已打开工作区过多，请重启后再试');
      const pending = this.load(root, key);
      this.states.set(key, pending);
      pending.catch(() => this.states.delete(key));
    }
    return this.states.get(key);
  }
  async load(root, key) {
    const dir = join(this.home, key);
    await mkdir(join(dir, 'runs'), {recursive: true});
    const info=await lstat(root,{bigint:true}), identity=[info.dev,info.ino].join(':');
    const state = {root, identity, key, dir, rows: new Map(), tail: Promise.resolve(), writes: Promise.resolve(), cleanup: Promise.resolve(), warnings: []};
    const files = (await readdir(join(dir, 'runs'))).filter(name => RUN_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
    for (const file of files) {
      const row = await readJson(join(dir, 'runs', file));
      if (row.schemaVersion !== 1 || row.id + '.json' !== file || typeof row.createdAt !== 'string') fail('INVALID_STORAGE', '操作记录格式不兼容，请保留数据并检查版本');
      if (ACTIVE.has(row.status)) {
        row.status = 'INTERRUPTED'; row.finishedAt = new Date().toISOString();
        row.message = '上次引擎结束前未记录最终结果。副作用未知，请检查工作区；不会自动重跑。';
        await this.persist(state, row);
      }
      state.rows.set(row.id, row);
    }
    await this.prune(state);
    return state;
  }
  async config(state) {
    const info=await lstat(state.root,{bigint:true});
    if(info.isSymbolicLink() || !info.isDirectory() || [info.dev,info.ino].join(':')!==state.identity) fail('WORKSPACE_CHANGED','工作区身份已变化，请重新打开并审阅信任');
    const saved = await optionalJson(join(state.dir, 'config.json'));
    let value = saved, source = 'desktop';
    if (value === null) {
      source = 'project';
      const path = join(state.root, '.dsh', 'project-actions.json');
      try {
        if (!within(state.root, await realpath(path))) fail('INVALID_CONFIG', '项目操作配置不能通过链接指向工作区外');
        value = await readJson(path);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const config = validateActionConfig(value ?? {schemaVersion: 1, actions: []});
    const fingerprint = digest(JSON.stringify({config,identity:state.identity,root:state.root}));
    const trust = await optionalJson(join(state.dir, 'trust.json'));
    const configRevision = this.hooks ? await this.hooks.revision(state.dir, fingerprint) : undefined;
    return {config, fingerprint, source, trusted: trust?.fingerprint === fingerprint, ...(configRevision === undefined ? {} : {configRevision})};
  }
  async inspect(path) {
    const state = await this.workspace(path);
    return {workspace: state.root, ...await this.config(state), runs: [...state.rows.values()].map(row=>({...row,canCancel:this.jobs.has(row.id)})).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), warnings: state.warnings};
  }
  async save(path, value) {
    const state = await this.workspace(path), config = validateActionConfig(value);
    const task = state.writes.catch(() => {}).then(async () => {
      await writeAtomic(join(state.dir, 'config.json'), JSON.stringify(config, null, 2));
      // Saving never grants trust. The UI reviews and approves the exact resulting hash separately.
    });
    state.writes = task; await task;
    return this.inspect(state.root);
  }
  async trust(path, fingerprint) {
    const state = await this.workspace(path);
    const task = state.writes.catch(() => {}).then(async () => {
      const current = await this.config(state);
      if (current.fingerprint !== fingerprint) fail('CONFIG_CHANGED', '配置已变化，请重新检查后信任');
      await writeAtomic(join(state.dir, 'trust.json'), JSON.stringify({schemaVersion: 1, fingerprint, approvedAt: new Date().toISOString()}));
    });
    state.writes = task; await task;
    return this.inspect(state.root);
  }
  async revoke(path) {
    const state = await this.workspace(path);
    // Revocation must remain available when the quota is full. Absence already
    // means untrusted; removing the grant requires no new storage reservation.
    const task = state.writes.catch(() => {}).then(() => unlink(join(state.dir, 'trust.json')).catch(error=>{if(error.code!=='ENOENT')throw error;}));
    state.writes = task; await task;
    return this.inspect(state.root);
  }
  async persist(state, row) { await writeAtomic(join(state.dir, 'runs', row.id + '.json'), JSON.stringify(row)); }
  async start(path, actionId, {signal, context, source = 'desktop'} = {}) {
    if (this.closed) fail('STOPPING', '引擎正在停止');
    const state = await this.workspace(path), current = await this.config(state);
    if (!current.trusted) fail('TRUST_REQUIRED', '请在项目操作页面检查并信任当前配置');
    const action = current.config.actions.find(action => action.id === actionId);
    if (!action) fail('ACTION_NOT_FOUND', '操作不存在');
    if ([...state.rows.values()].filter(row => ACTIVE.has(row.status)).length >= 16) fail('LIMIT', '当前工作区已有 16 个待完成操作');
    signal?.throwIfAborted();
    const storageLease=await storageAdmission.acquire(join(state.dir,'runs'),this.hooks ? 5*1024*1024 : 3*1024*1024,
      {signal, ...(this.hooks ? {terminalBytes:3*1024*1024} : {})});
    if(this.closed||signal?.aborted||[...state.rows.values()].filter(row=>ACTIVE.has(row.status)).length>=16){await storageLease.release().catch(()=>{});fail('STOPPING','存储准备期间操作已取消、引擎停止或队列已满');}
    const row = {schemaVersion: 1, id: randomUUID(), actionId, label: action.label, fingerprint: current.fingerprint, status: 'QUEUED', source, createdAt: new Date().toISOString()};
    if (action.artifacts?.length) row.artifacts = [...action.artifacts];
    state.rows.set(row.id, row);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once: true});
    const prior = state.tail;
    let wake;
    const cancelled = new Promise(resolve => { wake = resolve; });
    controller.signal.addEventListener('abort', wake, {once: true});
    const job = {state, row, controller};
    this.jobs.set(row.id, job);
    // Reserve the lane before awaiting disk writes, so concurrent UI/model calls cannot overlap.
    const initialWrite = storageLease.run(async()=>{await this.persist(state, row);
      await this.hooks?.queued(state.root, row, action, current.configRevision,
        context?.agent ? {sessionId:String(context.agent.session.id)} : null);});
    job.done = storageLease.run(()=>initialWrite.then(() => Promise.race([prior, cancelled])).then(async () => {
      if (controller.signal.aborted) { row.status = 'CANCELLED'; return; }
      const latest = await this.config(state);
      if (!latest.trusted || latest.fingerprint !== row.fingerprint) fail('CONFIG_CHANGED', '排队期间配置或信任已变化，操作未执行');
      const cwd = await realpath(resolve(state.root, action.cwd));
      if (!within(state.root, cwd)) fail('INVALID_WORKSPACE', '操作目录通过链接指向工作区外，操作未执行');
      controller.signal.throwIfAborted();
      row.status = 'RUNNING'; row.startedAt = new Date().toISOString();
      await this.persist(state, row);
      controller.signal.throwIfAborted();
      const result = await this.execute({...action, runId:row.id, cwd, workspace: state.root, signal: controller.signal, context,
        ...(this.hooks ? {recordExecution:settings=>this.hooks.prepare(state.root,row,action,settings)} : {})});
      const log = Buffer.from(`STDOUT\n${result.stdout?.text ?? ''}\nSTDERR\n${result.stderr?.text ?? ''}`);
      row.logTruncated = log.length > MAX_LOG || result.stdout?.truncated === true || result.stderr?.truncated === true;
      await writeAtomic(join(state.dir, 'runs', row.id + '.log'), log.subarray(0, MAX_LOG));
      row.status = result.aborted ? 'CANCELLED' : result.timedOut ? 'TIMEOUT' : result.sandbox?.runnerFailed ? 'RUNNER_FAILED' : result.exitCode === 0 ? 'PASS' : 'FAIL';
      row.exitCode = result.exitCode ?? null;
      row.aborted = result.aborted === true; row.timedOut = result.timedOut === true; row.signal = result.signal ?? null;
      row.effectiveTimeoutMs = result.timeoutMs ?? action.timeoutMs;
      if (result.sandbox) row.sandbox = result.sandbox;
      row.tail = log.toString().slice(-4000);
      row.logAvailable = true;
    }).catch(error => {
      row.status = controller.signal.aborted ? 'CANCELLED' : row.status === 'RUNNING' ? 'UNKNOWN' : 'NOT_STARTED';
      row.message = error instanceof ActionError ? error.message : row.status === 'UNKNOWN' ? '执行或记录结果失败，副作用未知。请查看工作区。' : '操作未完成，请检查引擎状态和本地存储。';
      const diagnostic = error?.code ?? (error instanceof Error ? error.message : undefined);
      if (typeof diagnostic === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/.test(diagnostic)) row.message += ` (${diagnostic})`;
    }).then(async () => {
      row.finishedAt = new Date().toISOString();
      row.durationMs = row.startedAt ? Date.parse(row.finishedAt) - Date.parse(row.startedAt) : 0;
      try { await storageLease.terminal(async()=>{await this.persist(state, row);
        try { await this.hooks?.settled(state.root, {...row}); }
        catch (error) { row.verificationCommit = 'UNKNOWN'; }
        await this.prune(state);}); } catch { row.persistenceFailed = true; }
      return {...row};
    })).finally(async () => {
      signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', wake);
      this.jobs.delete(row.id);
      await storageLease.release().catch(()=>{row.quotaReleasePending=true;});
    });
    state.tail = Promise.allSettled([prior, job.done]).then(() => {});
    if (signal?.aborted || this.closed) controller.abort();
    await initialWrite;
    return {...row};
  }
  async wait(path, id) {
    const state = await this.workspace(path);
    const job = this.jobs.get(id);
    if (job?.state === state) return job.done;
    const row = state.rows.get(id);
    if (!row) fail('NOT_FOUND', '操作记录不存在');
    return {...row};
  }
  async cancel(path, id) {
    const state = await this.workspace(path), job = this.jobs.get(id);
    if (!state.rows.has(id)) fail('NOT_FOUND', '操作记录不存在');
    if (job?.state === state) job.controller.abort();
    return {requested: !!job, id};
  }
  async log(path, id) {
    const state = await this.workspace(path);
    if (!RUN_ID.test(id) || !state.rows.get(id)?.logAvailable) fail('NOT_FOUND', '日志不可用');
    return readFile(join(state.dir, 'runs', id + '.log'), 'utf8');
  }
  async logReference(path, id) {
    const state = await this.workspace(path);
    if (!RUN_ID.test(id) || !state.rows.get(id)?.logAvailable) fail('NOT_FOUND', '日志不可用');
    return {root: join(state.dir, 'runs'), path: id + '.log'};
  }
  prune(state) {
    const task = state.cleanup.catch(() => {}).then(async () => {
      const finished = [...state.rows.values()].filter(row => !ACTIVE.has(row.status)).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      for (const row of finished.slice(100)) {
        await unlink(join(state.dir, 'runs', row.id + '.json'));
        await unlink(join(state.dir, 'runs', row.id + '.log')).catch(error => { if (error.code !== 'ENOENT') throw error; });
        state.rows.delete(row.id);
      }
    });
    state.cleanup = task;
    return task;
  }
  async close() {
    this.closed = true;
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map(job => job.done));
  }
}
