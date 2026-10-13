//! Serialized, sync-confirmed distribution ledger. No PID-only or time-based reclamation.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fs::{self, File, OpenOptions}, io::{Read, Seek, SeekFrom, Write},
    os::windows::{fs::{MetadataExt, OpenOptionsExt}, io::AsRawHandle}, path::{Path, PathBuf}, thread, time::Duration};
use windows_sys::Win32::{Foundation::{CloseHandle, FILETIME, WAIT_TIMEOUT},
    Storage::FileSystem::{BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle, GetDiskFreeSpaceExW, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_WRITE_THROUGH, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES},
    System::Threading::{OpenProcess, GetProcessTimes, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE}};
use std::os::windows::ffi::OsStrExt;
type Result<T> = std::result::Result<T, String>;
mod imports;
use imports::Import;
const MAX_LEDGER: u64 = 128 * 1024 * 1024;
const MAX_RECORD: usize = 4 * 1024 * 1024;
const MANAGED: &[&str] = &["nidofy-connections", "nidofy-import-connections.json", "nidofy-extras", "desktop-actions",
    "desktop-changes", "desktop-artifacts.json", "desktop-artifact-exports", "desktop-snapshot-scopes.json", "desktop-task-snapshots",
    "cache/nidofy-session-query.sqlite", "cache/nidofy-session-query.sqlite-wal", "cache/nidofy-session-query.sqlite-shm"];
const EXCLUDED: &[&str] = &["sessions", "storages", "attachments", "spill", "dsh-runtimes", "profiles", "settings.yaml", "settings.yml",
    ".credentials.yaml", ".credentials.yaml.lock", ".env", ".env.lock", "cordis.patch.yml", "node_modules", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
fn digest(data: &[u8]) -> String { format!("{:x}", Sha256::digest(data)) }
fn code<T>(_: T) -> String { "STORAGE_IO_UNKNOWN".into() }
fn safe_id(s: &str) -> Result<()> {
    if s.len() < 16 || s.len() > 128 || !s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return Err("STORAGE_ID_INVALID".into()); }
    Ok(())
}
fn plain(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() { if parent != path && !parent.as_os_str().is_empty() { plain(parent)?; } }
    let meta = fs::symlink_metadata(path).map_err(code)?;
    if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { return Err("STORAGE_LINK_REFUSED".into()); }
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ProcessIdentity { pid: u32, creation: u64 }
fn process_identity(pid: u32) -> Result<Option<ProcessIdentity>> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            // ERROR_INVALID_PARAMETER means that this process no longer exists. Access denied is unknown.
            if std::io::Error::last_os_error().raw_os_error() == Some(87) { return Ok(None); }
            return Err("STORAGE_OWNER_UNKNOWN".into());
        }
        let mut creation = FILETIME::default(); let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default(); let mut user = FILETIME::default();
        let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        let wait = WaitForSingleObject(handle, 0); CloseHandle(handle);
        if ok == 0 { return Err("STORAGE_OWNER_UNKNOWN".into()); }
        if wait == 0 { return Ok(None); }
        if wait != WAIT_TIMEOUT { return Err("STORAGE_OWNER_UNKNOWN".into()); }
        Ok(Some(ProcessIdentity { pid, creation: ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64 }))
    }
}
fn alive(identity: &ProcessIdentity) -> Result<bool> {
    if identity.pid == 0 || identity.creation == 0 { return Err("STORAGE_OWNER_UNKNOWN".into()); }
    Ok(process_identity(identity.pid)?.as_ref() == Some(identity))
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Phase { Reserved, Running, Terminal, Finished, Settled }
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Lease {
    operation_id: String, id: String, owner_epoch: String, owner: ProcessIdentity, home: PathBuf,
    scope: String, max_write_bytes: u64, terminal_bytes: u64, token_hash: String,
    phase: Phase, worker: Option<ProcessIdentity>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Ledger {
    schema_version: u32, root_id: String, limit_bytes: u64, safety_bytes: u64, measured_bytes: u64,
    homes: BTreeSet<PathBuf>, owners: BTreeMap<String, ProcessIdentity>, leases: BTreeMap<String, Lease>,
    #[serde(default)] imports: BTreeMap<String, Import>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub action: String, owner_epoch: String,
    #[serde(default)] pid: u32,
    #[serde(default)] limit_bytes: u64,
    #[serde(default)] safety_bytes: u64,
    #[serde(default)] operation_id: String,
    #[serde(default)] scope: String,
    #[serde(default)] max_write_bytes: u64,
    #[serde(default)] terminal_bytes: u64,
    #[serde(default)] token: String,
    #[serde(default)] fingerprint: String,
    #[serde(default)] path: PathBuf,
}
struct Transaction { file: File, state: Ledger, committed: Ledger, root: PathBuf, home: PathBuf, _pins: Vec<File> }
// Keep each directory's identity fixed until the ledger lock and writer handles close.
fn pin(path: &Path) -> Result<Vec<File>> {
    let mut pins = Vec::new();
    if let Some(parent) = path.parent() { if parent != path && !parent.as_os_str().is_empty() { pins = pin(parent)?; } }
    let file = OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES).share_mode(3)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(path).map_err(code)?;
    if file.metadata().map_err(code)?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { return Err("STORAGE_LINK_REFUSED".into()); }
    pins.push(file); Ok(pins)
}
fn file_identity(file: &File) -> Result<String> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 { return Err(code(())); }
    Ok(format!("{}:{}:{}", info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow))
}
impl Transaction {
    fn open(home: &Path, initial: Option<(u64, u64)>) -> Result<Self> {
        plain(home)?;
        let mut pins = pin(home)?;
        let home = fs::canonicalize(home).map_err(code)?;
        let imported = imports::home_operation(&home)?;
        let root = if imported.is_some() { home.ancestors().nth(3) } else { home.parent() }
            .ok_or("STORAGE_ROOT_REQUIRED")?.to_path_buf();
        let directory = root.join(".nidofy-storage-v1");
        if imported.is_some() && !directory.join("ledger.jsonl").is_file() { return Err("STORAGE_IMPORTED_HOME_REBIND_REQUIRED".into()); }
        fs::create_dir_all(&directory).map_err(code)?; plain(&directory)?;
        pins.extend(pin(&directory)?);
        let path = directory.join("ledger.jsonl");
        let mut file = None;
        for _ in 0..300 {
            match OpenOptions::new().read(true).write(true).create(true).share_mode(0).custom_flags(FILE_FLAG_WRITE_THROUGH | FILE_FLAG_OPEN_REPARSE_POINT).open(&path) {
                Ok(held) => { file = Some(held); break; },
                Err(e) if e.raw_os_error() == Some(32) => thread::sleep(Duration::from_millis(10)),
                Err(e) => return Err(code(e)),
            }
        }
        let mut file = file.ok_or("STORAGE_BUSY")?;
        let mut ledger_info = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut ledger_info) } == 0
            || ledger_info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 || ledger_info.nNumberOfLinks != 1 {
            return Err("STORAGE_LINK_REFUSED".into());
        }
        if file.metadata().map_err(code)?.len() > MAX_LEDGER { return Err("STORAGE_LEDGER_FULL".into()); }
        let root_handle = OpenOptions::new().read(true).custom_flags(0x02000000).open(&root).map_err(code)?;
        let root_id = file_identity(&root_handle)?;
        let mut bytes = Vec::new(); file.read_to_end(&mut bytes).map_err(code)?;
        let mut state: Option<Ledger> = None; let mut valid = 0;
        for line in bytes.split_inclusive(|b| *b == b'\n') {
            if !line.ends_with(b"\n") { break; }
            let (seal, body) = line.split_at(64.min(line.len()));
            if body.first() != Some(&b' ') || body.len() < 3 || digest(&body[1..body.len()-1]).as_bytes() != seal {
                return Err("STORAGE_LEDGER_CORRUPT".into());
            }
            let value: Value = serde_json::from_slice(&body[1..body.len()-1]).map_err(|_| "STORAGE_LEDGER_CORRUPT")?;
            if value["schemaVersion"] == 2 && value.get("imports").is_none() { return Err("STORAGE_LEDGER_CORRUPT".into()); }
            let mut parsed: Ledger = serde_json::from_value(value).map_err(|_| "STORAGE_LEDGER_CORRUPT")?;
            if !(1..=2).contains(&parsed.schema_version) || parsed.root_id != root_id { return Err("STORAGE_ROOT_CONFLICT".into()); }
            if parsed.schema_version == 1 && !parsed.imports.is_empty() { return Err("STORAGE_LEDGER_CORRUPT".into()); }
            // Records carry owner/lease upserts. Settled identities remain queryable; no deletion or replay fallback.
            if let Some(mut previous) = state.take() {
                if parsed.schema_version < previous.schema_version { return Err("STORAGE_LEDGER_CORRUPT".into()); }
                previous.owners.append(&mut parsed.owners); parsed.owners = previous.owners;
                previous.leases.append(&mut parsed.leases); parsed.leases = previous.leases;
                previous.imports.append(&mut parsed.imports); parsed.imports = previous.imports;
                parsed.homes.extend(previous.homes);
            }
            state = Some(parsed); valid += line.len();
        }
        if valid != bytes.len() { file.set_len(valid as u64).map_err(code)?; }
        let state = match state { Some(s) => s, None => {
            let (limit_bytes, safety_bytes) = initial.ok_or("STORAGE_NOT_INITIALIZED")?;
            if limit_bytes == 0 || safety_bytes == 0 { return Err("STORAGE_LIMIT_INVALID".into()); }
            Ledger { schema_version: 2, root_id, limit_bytes, safety_bytes, measured_bytes: 0,
                homes: BTreeSet::new(), owners: BTreeMap::new(), leases: BTreeMap::new(), imports: BTreeMap::new() }
        }};
        // A complete but previously unacknowledged record is confirmed before any inspect response.
        file.sync_all().map_err(code)?;
        let committed = state.clone();
        let tx = Self { file, state, committed, root, home, _pins: pins };
        if let Some(id) = imported { imports::check_adopted(&tx, &id)?; }
        Ok(tx)
    }
    fn commit(&mut self) -> Result<()> {
        self.state.schema_version = 2;
        let mut delta = self.state.clone();
        delta.owners.retain(|id, owner| self.committed.owners.get(id) != Some(owner));
        delta.leases.retain(|id, lease| self.committed.leases.get(id) != Some(lease));
        delta.imports.retain(|id, operation| self.committed.imports.get(id) != Some(operation));
        let body = serde_json::to_vec(&delta).map_err(code)?;
        if body.len() > MAX_RECORD || self.file.metadata().map_err(code)?.len() + body.len() as u64 + 66 > MAX_LEDGER {
            return Err("STORAGE_LEDGER_FULL".into());
        }
        // Imports may debit many writes. Recheck each journal append instead of treating the
        // initial five-record margin as permission for unbounded additional metadata.
        if !delta.imports.is_empty() {
        let unsettled: Vec<_> = self.state.leases.values().filter(|l| l.phase != Phase::Settled).collect();
        let held: u64 = unsettled.iter().map(|l| l.max_write_bytes + l.terminal_bytes).sum();
        let metadata = (unsettled.len() as u64).saturating_mul(5 * MAX_RECORD as u64);
        let wide: Vec<u16> = self.root.as_os_str().encode_wide().chain(Some(0)).collect(); let mut available = 0;
        if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) } == 0
            || available < held.saturating_add(metadata).saturating_add(self.state.safety_bytes).saturating_add(body.len() as u64 + 66) {
            return Err("STORAGE_DISK_UNAVAILABLE".into());
        }
        }
        self.file.seek(SeekFrom::End(0)).map_err(code)?;
        self.file.write_all(format!("{} ", digest(&body)).as_bytes()).map_err(code)?;
        self.file.write_all(&body).map_err(code)?; self.file.write_all(b"\n").map_err(code)?;
        #[cfg(test)]
        if FAIL_SYNC.with(|fault| fault.replace(false)) { return Err("STORAGE_IO_UNKNOWN".into()); }
        self.file.sync_all().map_err(code)?;
        self.committed = self.state.clone(); Ok(())
    }
    fn sweep(&mut self) -> Result<bool> {
        if imports::active(&self.state)? { return Ok(false); }
        for lease in self.state.leases.values_mut() {
            if lease.phase == Phase::Settled { continue; }
            if let Some(worker) = &lease.worker { if alive(worker)? { return Ok(false); } }
            if lease.phase != Phase::Finished && alive(&lease.owner)? { return Ok(false); }
        }
        let mut seen = BTreeSet::new(); let mut total = 0;
        for home in &self.state.homes {
            for entry in fs::read_dir(home).map_err(code)? {
                let name = entry.map_err(code)?.file_name().to_string_lossy().into_owned();
                if name.starts_with(".snapshot-scopes-") && name.ends_with(".tmp") {
                    measure(&home.join(&name), &mut seen, &mut total)?; continue;
                }
                if !MANAGED.iter().any(|p| p.split('/').next() == Some(&name)) && !EXCLUDED.contains(&name.as_str()) {
                    return Err("STORAGE_SCAN_INCOMPLETE".into());
                }
            }
            let cache = home.join("cache");
            if cache.exists() { plain(&cache)?; for entry in fs::read_dir(&cache).map_err(code)? {
                let name = format!("cache/{}", entry.map_err(code)?.file_name().to_string_lossy());
                if !MANAGED.contains(&name.as_str()) { return Err("STORAGE_SCAN_INCOMPLETE".into()); }
            }}
            for path in MANAGED { measure(&home.join(path), &mut seen, &mut total)?; }
            // Failed native scope temporaries are managed residue, never silently ignored.
        }
        imports::measure_imports(self, &mut seen, &mut total)?;
        self.state.measured_bytes = total;
        for lease in self.state.leases.values_mut() { lease.phase = Phase::Settled; lease.worker = None; }
        Ok(true)
    }
}
fn measure(path: &Path, seen: &mut BTreeSet<String>, total: &mut u64) -> Result<()> {
    let before = match fs::symlink_metadata(path) { Ok(v) => v, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(e) => return Err(code(e)) };
    if before.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { return Err("STORAGE_SCAN_INCOMPLETE".into()); }
    if before.is_dir() {
        let entries: Vec<_> = fs::read_dir(path).map_err(code)?.collect::<std::result::Result<_, _>>().map_err(code)?;
        for entry in entries { measure(&entry.path(), seen, total)?; }
        let after = fs::metadata(path).map_err(code)?;
        if before.last_write_time() != after.last_write_time() { return Err("STORAGE_SCAN_UNSTABLE".into()); }
    } else if before.is_file() {
        let file = OpenOptions::new().read(true).share_mode(1).open(path).map_err(code)?;
        let meta = file.metadata().map_err(code)?;
        if before.file_size() != meta.file_size() || before.last_write_time() != meta.last_write_time() { return Err("STORAGE_SCAN_UNSTABLE".into()); }
        if seen.insert(file_identity(&file)?) { *total = total.checked_add(meta.len()).ok_or("STORAGE_SIZE_INVALID")?; }
    } else { return Err("STORAGE_SCAN_INCOMPLETE".into()); }
    Ok(())
}
fn observation(lease: &Lease, root: &str) -> Value {
    json!({"id":lease.id,"operationId":lease.operation_id,"rootId":root,"reservedBytes":lease.max_write_bytes,
        "terminalBytes":lease.terminal_bytes,"status":if lease.phase == Phase::Settled { "settled" } else { "reserved" }, "phase":lease.phase})
}
fn capacity(tx: &Transaction, drained: Option<bool>, scan: &str) -> Result<Value> {
    let grants: Vec<_> = tx.state.leases.values().filter(|l| l.phase != Phase::Settled).collect();
    let ordinary: u64 = grants.iter().map(|l| l.max_write_bytes).sum();
    let terminal: u64 = grants.iter().map(|l| l.terminal_bytes).sum();
    Ok(json!({"rootId":tx.state.root_id,"drained":drained,"measuredBytes":if drained == Some(true) { Some(tx.state.measured_bytes) } else { None },
        "observedBytes":tx.state.measured_bytes,"reservedBytes":ordinary + terminal,"ordinaryBytes":ordinary,"terminalBytes":terminal,
        "limitBytes":tx.state.limit_bytes,"safetyBytes":tx.state.safety_bytes,"pendingOperations":grants.len(),"scan":scan,
        "ledgerBytes":tx.file.metadata().map_err(code)?.len(),"ledgerLimitBytes":MAX_LEDGER}))
}
pub fn dispatch(home: &Path, request: Request) -> Result<Value> {
    safe_id(&request.owner_epoch)?;
    let mut tx = Transaction::open(home, if request.action == "open" { Some((request.limit_bytes, request.safety_bytes)) } else { None })?;
    if request.action == "open" {
        let owner = process_identity(request.pid)?.ok_or("STORAGE_OWNER_EXITED")?;
        if let Some(old) = tx.state.owners.get(&request.owner_epoch) { if old != &owner { return Err("STORAGE_OWNER_CONFLICT".into()); } }
        if !tx.state.homes.contains(&tx.home) && tx.state.leases.values().any(|l| l.phase != Phase::Settled) { return Err("STORAGE_REGISTRATION_BUSY".into()); }
        tx.state.homes.insert(tx.home.clone()); tx.state.owners.insert(request.owner_epoch, owner);
        // Registration/query stays available when a scan is incomplete; capacity changes still require reconciliation.
        tx.commit()?;
        return Ok(json!({"rootId":tx.state.root_id,"limitBytes":tx.state.limit_bytes}));
    }
    let owner = tx.state.owners.get(&request.owner_epoch).ok_or("STORAGE_OWNER_REQUIRED")?.clone();
    if !alive(&owner)? { return Err("STORAGE_OWNER_EXITED".into()); }
    if request.action == "import-root" { return Ok(json!({"path":tx.root.join("imports")})); }
    if request.action.starts_with("import-") && request.action != "import-start" {
        return imports::dispatch(&mut tx, &request);
    }
    if request.action == "inspect" {
        return Ok(tx.state.leases.get(&request.operation_id).map(|l| observation(l, &tx.state.root_id)).unwrap_or(json!({"status":"unknown"})));
    }
    // Status never sweeps or changes grants; opening the journal retains its existing sync/repair rules.
    if request.action == "status" { return capacity(&tx, None, "not-run"); }
    if request.action == "configure" {
        if request.limit_bytes == 0 { return Err("STORAGE_LIMIT_INVALID".into()); }
        tx.state.limit_bytes = request.limit_bytes; tx.commit()?;
        return Ok(json!({"limitBytes":tx.state.limit_bytes}));
    }
    if request.action == "recover" {
        let swept = tx.sweep()?; tx.commit()?;
        return capacity(&tx, Some(swept), if swept { "complete" } else { "incomplete" });
    }
    safe_id(&request.operation_id)?;
    if request.action == "reserve" || request.action == "import-start" {
        safe_id(&request.token)?;
        if let Some(old) = tx.state.leases.get(&request.operation_id) {
            if request.action == "import-start" { return Err("IMPORT_OPERATION_EXISTS".into()); }
            if old.owner_epoch != request.owner_epoch || old.token_hash != digest(request.token.as_bytes()) || old.scope != request.scope
                || old.max_write_bytes != request.max_write_bytes || old.terminal_bytes != request.terminal_bytes || old.home != tx.home {
                return Err("STORAGE_OPERATION_CONFLICT".into());
            }
            return Ok(observation(old, &tx.state.root_id));
        }
        if request.scope.is_empty() || request.scope.len() > 80 || request.max_write_bytes > 1024*1024*1024 || request.terminal_bytes > 16*1024*1024
            || request.max_write_bytes + request.terminal_bytes == 0 { return Err("STORAGE_RESERVATION_INVALID".into()); }
        tx.sweep()?;
        let held: u64 = tx.state.leases.values().filter(|l| l.phase != Phase::Settled).map(|l| l.max_write_bytes + l.terminal_bytes).sum();
        let metadata = (1 + tx.state.leases.values().filter(|l| l.phase != Phase::Settled).count() as u64)
            .saturating_mul(5 * MAX_RECORD as u64);
        let needed = request.max_write_bytes + request.terminal_bytes;
        if tx.state.measured_bytes.saturating_add(held).saturating_add(needed) > tx.state.limit_bytes { return Err("STORAGE_QUOTA_EXCEEDED".into()); }
        let wide: Vec<u16> = tx.root.as_os_str().encode_wide().chain(Some(0)).collect(); let mut available = 0;
        if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) } == 0
            || available < held.saturating_add(needed).saturating_add(tx.state.safety_bytes).saturating_add(metadata) { return Err("STORAGE_DISK_UNAVAILABLE".into()); }
        if request.action == "import-start" { imports::start(&mut tx, &request, &owner)?; }
        let lease = Lease { id: request.operation_id.clone(), operation_id: request.operation_id.clone(), owner_epoch: request.owner_epoch,
            owner, home: tx.home.clone(), scope: request.scope, max_write_bytes: request.max_write_bytes, terminal_bytes: request.terminal_bytes,
            token_hash: digest(request.token.as_bytes()), phase: Phase::Reserved, worker: None };
        let result = observation(&lease, &tx.state.root_id); tx.state.leases.insert(request.operation_id, lease); tx.commit()?; return Ok(result);
    }
    if request.action == "settle" || request.action == "release" {
        let lease = tx.state.leases.get_mut(&request.operation_id).ok_or("STORAGE_LEASE_UNKNOWN")?;
        if lease.owner_epoch != request.owner_epoch || lease.token_hash != digest(request.token.as_bytes()) { return Err("STORAGE_LEASE_REFUSED".into()); }
        if lease.phase == Phase::Settled { return Ok(observation(lease, &tx.state.root_id)); }
        if let Some(worker) = &lease.worker { if alive(worker)? { return Err("STORAGE_WRITER_ACTIVE".into()); } }
        lease.phase = Phase::Finished; lease.worker = None;
        // Save the writer-drained fact before scanning. A failed scan retains every charge.
        tx.commit()?; tx.sweep()?; tx.commit()?;
        return Ok(observation(&tx.state.leases[&request.operation_id], &tx.state.root_id));
    }
    Err("STORAGE_ACTION_UNSUPPORTED".into())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Capability { operation_id: String, token: String }
pub struct Guard { owner: ProcessIdentity, ordinary: u64, terminal: u64, terminal_only: bool }
thread_local! { static ACTIVE: std::cell::RefCell<Option<Guard>> = const { std::cell::RefCell::new(None) }; }
pub fn consume(home: &Path, capability: Capability, scope: &str, required: u64, terminal: bool) -> Result<()> {
    let mut tx = Transaction::open(home, None)?;
    let lease = tx.state.leases.get_mut(&capability.operation_id).ok_or("STORAGE_LEASE_UNKNOWN")?;
    let permitted_phase = lease.phase == Phase::Reserved || terminal && lease.phase == Phase::Running
        && lease.worker.as_ref().map(alive).transpose()?.is_some_and(|active| !active);
    if lease.home != tx.home || lease.scope != scope || !permitted_phase || lease.token_hash != digest(capability.token.as_bytes())
        || !alive(&lease.owner)? || if terminal { lease.terminal_bytes < required } else { lease.max_write_bytes < required } {
        return Err("STORAGE_LEASE_REFUSED".into());
    }
    lease.worker = process_identity(std::process::id())?; lease.phase = if terminal { Phase::Terminal } else { Phase::Running };
    let guard = Guard { owner: lease.owner.clone(), ordinary: lease.max_write_bytes, terminal: lease.terminal_bytes, terminal_only: terminal };
    tx.commit()?; ACTIVE.with(|slot| *slot.borrow_mut() = Some(guard)); Ok(())
}
pub fn before_write(bytes: usize, terminal: bool) -> Result<()> {
    ACTIVE.with(|slot| {
        let mut state = slot.borrow_mut();
        let Some(guard) = state.as_mut() else {
            // Unit tests exercise file primitives; production native commands must consume a lease.
            return if cfg!(test) { Ok(()) } else { Err("STORAGE_LEASE_REQUIRED".into()) };
        };
        let terminal = terminal || guard.terminal_only;
        if !terminal && !alive(&guard.owner)? { return Err("STORAGE_OWNER_EXITED".into()); }
        let remaining = if terminal { &mut guard.terminal } else { &mut guard.ordinary };
        if *remaining < bytes as u64 { return Err("STORAGE_LEASE_EXHAUSTED".into()); }
        *remaining -= bytes as u64; Ok(())
    })
}

#[cfg(test)]
thread_local! { static FAIL_SYNC: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_identity_requires_creation_time_not_only_pid() {
        let actual = process_identity(std::process::id()).unwrap().unwrap();
        assert!(alive(&actual).unwrap());
        assert!(alive(&ProcessIdentity { pid: actual.pid, creation: 0 }).is_err());
        let different_creation = ProcessIdentity { creation: actual.creation + 1, ..actual };
        assert!(!alive(&different_creation).unwrap());
    }
    struct Home(PathBuf);
    impl Home {
        fn new() -> Self {
            let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let root = std::env::temp_dir().join(format!("native-quota-{}-{id}", std::process::id()));
            fs::create_dir_all(root.join("home")).unwrap(); Self(root)
        }
        fn path(&self) -> PathBuf { self.0.join("home") }
    }
    impl Drop for Home {
        fn drop(&mut self) { assert!(self.0.starts_with(std::env::temp_dir())); fs::remove_dir_all(&self.0).unwrap(); }
    }
    #[test]
    fn unknown_sync_retains_complete_reservation_on_reopen() {
        let home = Home::new();
        let request = |action: &str| serde_json::from_value(json!({"action":action,"ownerEpoch":"quota-owner-000001",
            "pid":std::process::id(),"limitBytes":1048576,"safetyBytes":1048576,
            "operationId":"quota-operation-000001","scope":"node:test","token":"quota-private-token-000001","maxWriteBytes":800000})).unwrap();
        dispatch(&home.path(), request("open")).unwrap();
        FAIL_SYNC.with(|fault| fault.set(true));
        assert_eq!(dispatch(&home.path(), request("reserve")).unwrap_err(), "STORAGE_IO_UNKNOWN");
        assert_eq!(dispatch(&home.path(), request("inspect")).unwrap()["status"], "reserved");
        assert_eq!(dispatch(&home.path(), request("recover")).unwrap()["drained"], false);
    }
    #[test]
    fn v1_prefix_is_retained_when_v2_appends_and_future_schema_refuses() {
        let home = Home::new(); let mut tx = Transaction::open(&home.path(), Some((1048576, 1048576))).unwrap();
        let mut old = serde_json::to_value(&tx.state).unwrap(); old.as_object_mut().unwrap().remove("imports"); old["schemaVersion"] = json!(1);
        let bytes = serde_json::to_vec(&old).unwrap();
        let prefix = format!("{} {}\n", digest(&bytes), String::from_utf8(bytes).unwrap());
        tx.file.write_all(prefix.as_bytes()).unwrap(); tx.file.sync_all().unwrap(); drop(tx);
        let mut tx = Transaction::open(&home.path(), None).unwrap(); tx.commit().unwrap(); drop(tx);
        let saved = fs::read(home.0.join(".nidofy-storage-v1/ledger.jsonl")).unwrap(); assert!(saved.starts_with(prefix.as_bytes()));
        let mut future = old; future["schemaVersion"] = json!(99); let bytes = serde_json::to_vec(&future).unwrap();
        let mut file = OpenOptions::new().append(true).open(home.0.join(".nidofy-storage-v1/ledger.jsonl")).unwrap();
        file.write_all(format!("{} {}\n",digest(&bytes),String::from_utf8(bytes).unwrap()).as_bytes()).unwrap(); drop(file);
        assert!(Transaction::open(&home.path(), None).is_err());
    }
    #[test]
    fn native_format_schema_matches_serialized_fields_and_phases() {
        let schema: Value = serde_json::from_str(include_str!("../quota.schema.json")).unwrap();
        let home = Home::new(); let tx = Transaction::open(&home.path(), Some((1048576, 1048576))).unwrap();
        fn keys(value: &Value) -> BTreeSet<String> { value.as_object().unwrap().keys().cloned().collect() }
        assert_eq!(keys(&serde_json::to_value(&tx.state).unwrap()), keys(&schema["properties"]));
        let process = process_identity(std::process::id()).unwrap().unwrap();
        assert_eq!(keys(&serde_json::to_value(&process).unwrap()), keys(&schema["$defs"]["process"]["properties"]));
        let lease = Lease { operation_id:"operation".into(),id:"id".into(),owner_epoch:"epoch".into(),owner:process,
            home:home.path(),scope:"scope".into(),max_write_bytes:1,terminal_bytes:1,token_hash:digest(b"token"),phase:Phase::Reserved,worker:None };
        assert_eq!(keys(&serde_json::to_value(lease).unwrap()), keys(&schema["$defs"]["lease"]["properties"]));
        let phases = vec![Phase::Reserved, Phase::Running, Phase::Terminal, Phase::Finished, Phase::Settled];
        assert_eq!(serde_json::to_value(phases).unwrap(), schema["$defs"]["lease"]["properties"]["phase"]["enum"]);
        assert!(serde_json::from_value::<Phase>(json!("unknown")).is_err());
    }
}
