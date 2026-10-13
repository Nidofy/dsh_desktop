//! Import authority stays in the original physical distribution ledger, including adoption.
use super::*;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ImportPhase { Copying, Publishing, Ready, Interrupted, Adopted }
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct Import {
    operation_id: String, owner: ProcessIdentity, fingerprint: String, directory_id: String,
    home_id: String, receipt_digest: String, spent_bytes: u64, retained_bytes: u64, phase: ImportPhase,
}
pub(super) fn home_operation(home: &Path) -> Result<Option<String>> {
    if !home.components().any(|p| p.as_os_str().to_string_lossy().eq_ignore_ascii_case("imports")) { return Ok(None); }
    let operation = home.parent().ok_or("STORAGE_IMPORTED_HOME_REBIND_REQUIRED")?;
    if home.file_name().is_none_or(|v| v != "harness") || operation.parent().and_then(Path::file_name).is_none_or(|v| v != "imports") {
        return Err("STORAGE_IMPORTED_HOME_REBIND_REQUIRED".into());
    }
    let id = operation.file_name().ok_or("STORAGE_IMPORTED_HOME_REBIND_REQUIRED")?.to_string_lossy().to_string();
    safe_id(&id)?; Ok(Some(id))
}
fn identity(path: &Path) -> Result<String> {
    let held = pin(path)?; file_identity(held.last().ok_or("IMPORT_IDENTITY_UNKNOWN")?)
}
fn present(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false), Err(error) => Err(code(error)),
    }
}
pub(super) fn check_adopted(tx: &Transaction, id: &str) -> Result<()> {
    let op = tx.state.imports.get(id).ok_or("STORAGE_IMPORTED_HOME_REBIND_REQUIRED")?;
    if op.phase != ImportPhase::Adopted || identity(&tx.home)? != op.home_id
        || identity(tx.home.parent().unwrap())? != op.directory_id { return Err("STORAGE_IMPORTED_HOME_REBIND_REQUIRED".into()); }
    Ok(())
}
pub(super) fn active(state: &Ledger) -> Result<bool> {
    for op in state.imports.values() {
        if matches!(op.phase, ImportPhase::Copying | ImportPhase::Publishing) && alive(&op.owner)? { return Ok(true); }
    }
    Ok(false)
}
pub(super) fn measure_imports(tx: &Transaction, seen: &mut BTreeSet<String>, total: &mut u64) -> Result<()> {
    let root = tx.root.join("imports");
    if !present(&root)? { return Ok(()); }
    plain(&root)?;
    for entry in fs::read_dir(&root).map_err(code)? {
        let entry = entry.map_err(code)?;
        let id = entry.file_name().to_string_lossy().to_string();
        if let Some(op) = tx.state.imports.get(&id).filter(|op| op.phase == ImportPhase::Adopted) {
            if identity(&entry.path())? != op.directory_id || identity(&entry.path().join("harness"))? != op.home_id {
                return Err("IMPORT_ADOPTION_CONFLICT".into());
            }
            // Imported excluded bytes remain a conservative fixed charge; subsequent official
            // Session/attachment/runtime growth follows ordinary home exclusions, without double counting.
            *total = total.checked_add(op.retained_bytes).ok_or("STORAGE_SIZE_INVALID")?;
            for child in fs::read_dir(entry.path()).map_err(code)? {
                let child = child.map_err(code)?;
                // The Desktop carrier owns <dataRoot>/electron outside managed home storage,
                // including when that data root is an explicitly adopted import directory.
                if child.file_name() != "harness" && !child.file_name().to_string_lossy().eq_ignore_ascii_case("electron") {
                    measure(&child.path(), seen, total)?;
                }
            }
        } else { measure(&entry.path(), seen, total)?; }
    }
    Ok(())
}
fn locations(tx: &Transaction, id: &str) -> (PathBuf, PathBuf) {
    let root = tx.root.join("imports"); (root.join(format!("{id}.pending")), root.join(id))
}
fn observe(tx: &Transaction, op: &Import) -> Value {
    let (staging, final_path) = locations(tx, &op.operation_id);
    // Environment consumers (including the Loader watcher) require a DOS/UNC home spelling.
    // Authority and on-disk identity continue to use the canonical extended path.
    let home = final_path.join("harness").to_string_lossy().to_string();
    let home = if let Some(unc) = home.strip_prefix(r"\\?\UNC\") { format!(r"\\{unc}") }
        else { home.strip_prefix(r"\\?\").unwrap_or(&home).to_string() };
    json!({"operationId":op.operation_id,"quotaOperationId":op.operation_id,"rootId":tx.state.root_id,
        "phase":op.phase,"fingerprint":op.fingerprint,"spentBytes":op.spent_bytes,"retainedExcludedBytes":op.retained_bytes,
        "staging":staging,"dataRoot":final_path,"home":home,
        "quota":tx.state.leases.get(&op.operation_id).map(|lease| observation(lease, &tx.state.root_id))})
}
pub(super) fn start(tx: &mut Transaction, request: &Request, owner: &ProcessIdentity) -> Result<()> {
    // Import identity is also the quota operation identity; no mutable lookup or second journal.
    let id = &request.operation_id;
    if id.len() != 36 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
        || request.scope != "node:import" || request.fingerprint.len() != 64
        || !request.fingerprint.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("IMPORT_REQUEST_INVALID".into()); }
    let (staging, final_path) = locations(tx, id);
    if present(&staging)? || present(&final_path)? || tx.state.imports.contains_key(id) { return Err("IMPORT_RESIDUE_REQUIRES_REVIEW".into()); }
    let parent = staging.parent().unwrap(); fs::create_dir_all(parent).map_err(code)?; plain(parent)?;
    tx._pins.extend(pin(parent)?);
    fs::create_dir(&staging).map_err(code)?;
    let op = Import { operation_id:id.clone(), owner:owner.clone(), fingerprint:request.fingerprint.clone(),
        directory_id:identity(&staging)?, home_id:String::new(), receipt_digest:String::new(), spent_bytes:0, retained_bytes:0, phase:ImportPhase::Copying };
    tx.state.imports.insert(id.clone(), op); Ok(())
}
fn authorized(tx: &Transaction, request: &Request) -> Result<()> {
    let lease = tx.state.leases.get(&request.operation_id).ok_or("STORAGE_LEASE_UNKNOWN")?;
    if lease.owner_epoch != request.owner_epoch || lease.home != tx.home || lease.scope != "node:import"
        || lease.token_hash != digest(request.token.as_bytes()) || lease.phase != Phase::Reserved { return Err("STORAGE_LEASE_REFUSED".into()); }
    Ok(())
}
fn read_receipt(path: &Path, op: &Import) -> Result<(String, Value)> {
    let path = path.join("import.json"); plain(&path)?;
    let file = OpenOptions::new().read(true).share_mode(1).open(path).map_err(code)?;
    if file.metadata().map_err(code)?.len() > 2 * 1024 * 1024 { return Err("IMPORT_RECEIPT_INVALID".into()); }
    let mut bytes = Vec::new(); file.take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(code)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(code)?;
    if value["status"] != "READY" || value["operationId"] != op.operation_id || value["fingerprint"] != op.fingerprint {
        return Err("IMPORT_RECEIPT_INVALID".into());
    }
    Ok((digest(&bytes), value))
}
fn receipt(path: &Path, op: &Import) -> Result<String> { Ok(read_receipt(path, op)?.0) }
fn complete_publication(tx: &mut Transaction, op: &mut Import) -> Result<()> {
    let (staging, final_path) = locations(tx, &op.operation_id);
    if present(&staging)? && present(&final_path)? { return Err("IMPORT_PUBLICATION_CONFLICT".into()); }
    let current = if present(&final_path)? { &final_path } else { &staging };
    if identity(current)? != op.directory_id || identity(&current.join("harness"))? != op.home_id
        || receipt(current, op)? != op.receipt_digest { return Err("IMPORT_PUBLICATION_CONFLICT".into()); }
    #[cfg(test)]
    if STOP_PUBLICATION.with(|fault| fault.get() == 1) { STOP_PUBLICATION.with(|fault| fault.set(0)); return Err("IMPORT_TEST_STOP".into()); }
    if current == &staging { fs::rename(&staging, &final_path).map_err(code)?; }
    #[cfg(test)]
    if STOP_PUBLICATION.with(|fault| fault.get() == 2) { STOP_PUBLICATION.with(|fault| fault.set(0)); return Err("IMPORT_TEST_STOP".into()); }
    op.phase = ImportPhase::Ready;
    tx.state.imports.insert(op.operation_id.clone(), op.clone()); tx.commit()
}
pub(super) fn dispatch(tx: &mut Transaction, request: &Request) -> Result<Value> {
    safe_id(&request.operation_id)?;
    let Some(mut op) = tx.state.imports.get(&request.operation_id).cloned() else {
        return if request.action == "import-inspect" { Ok(json!({"phase":"unknown","operationId":request.operation_id})) }
            else { Err("IMPORT_OPERATION_UNKNOWN".into()) };
    };
    if request.action == "import-inspect" { return Ok(observe(tx, &op)); }
    if request.action == "import-review" {
        if !matches!(op.phase, ImportPhase::Ready | ImportPhase::Adopted) { return Err("IMPORT_REVIEW_NOT_READY".into()); }
        let (_, final_path) = locations(tx, &op.operation_id);
        tx._pins.extend(pin(&final_path.join("harness"))?);
        if identity(&final_path)? != op.directory_id || identity(&final_path.join("harness"))? != op.home_id {
            return Err("IMPORT_REVIEW_CONFLICT".into());
        }
        let (seal, value) = read_receipt(&final_path, &op)?;
        if seal != op.receipt_digest { return Err("IMPORT_REVIEW_CONFLICT".into()); }
        let report = value.get("report").cloned().unwrap_or(Value::Null);
        if !report.is_null() && (report["schemaVersion"] != 1 || !report["categories"].is_array()
            || report["categories"].as_array().is_some_and(|rows| rows.len() > 16)) {
            return Err("IMPORT_REVIEW_UNSUPPORTED".into());
        }
        if serde_json::to_vec(&report).map_err(code)?.len() > 128 * 1024 { return Err("IMPORT_REVIEW_TOO_LARGE".into()); }
        let mut observation = observe(tx, &op);
        observation["report"] = report;
        observation["sourceVersion"] = value["sourceVersion"].clone();
        return Ok(observation);
    }
    let (staging, final_path) = locations(tx, &op.operation_id);
    match request.action.as_str() {
        "import-write" => {
            authorized(tx, request)?;
            if op.phase != ImportPhase::Copying || identity(&staging)? != op.directory_id { return Err("IMPORT_PHASE_CONFLICT".into()); }
            let relative = request.path.strip_prefix(&staging).map_err(|_| "STORAGE_PATH_REFUSED")?;
            if relative.as_os_str().is_empty() || relative.components().any(|p| !matches!(p, std::path::Component::Normal(_))) {
                return Err("STORAGE_PATH_REFUSED".into());
            }
            let mut cursor = request.path.as_path();
            while !cursor.exists() { cursor = cursor.parent().ok_or("STORAGE_PATH_REFUSED")?; }
            tx._pins.extend(pin(cursor)?);
            op.spent_bytes = op.spent_bytes.checked_add(request.max_write_bytes).ok_or("STORAGE_SIZE_INVALID")?;
            if op.spent_bytes > tx.state.leases[&op.operation_id].max_write_bytes { return Err("IMPORT_WRITE_LIMIT".into()); }
            tx.state.imports.insert(op.operation_id.clone(), op.clone()); tx.commit()?;
        },
        "import-publish" => {
            authorized(tx, request)?;
            if op.phase != ImportPhase::Copying || identity(&staging)? != op.directory_id { return Err("IMPORT_PHASE_CONFLICT".into()); }
            op.home_id = identity(&staging.join("harness"))?; op.receipt_digest = receipt(&staging, &op)?;
            op.phase = ImportPhase::Publishing;
            tx.state.imports.insert(op.operation_id.clone(), op.clone()); tx.commit()?;
            complete_publication(tx, &mut op)?;
        },
        "import-abort" => {
            authorized(tx, request)?;
            // Publishing may already have renamed: never overwrite that outcome with cancellation.
            if op.phase == ImportPhase::Copying {
                op.phase = ImportPhase::Interrupted; tx.state.imports.insert(op.operation_id.clone(), op.clone()); tx.commit()?;
            }
        },
        "import-recover" => {
            if matches!(op.phase, ImportPhase::Copying | ImportPhase::Publishing) {
                if alive(&op.owner)? { return Err("STORAGE_WRITER_ACTIVE".into()); }
                if op.phase == ImportPhase::Publishing { complete_publication(tx, &mut op)?; }
                else { op.phase = ImportPhase::Interrupted; tx.state.imports.insert(op.operation_id.clone(), op.clone()); tx.commit()?; }
            }
            // This is explicit recovery, never a status side effect or a copy replay.
            tx.sweep()?; tx.commit()?;
        },
        "import-adopt" => {
            if !matches!(op.phase, ImportPhase::Ready | ImportPhase::Adopted) || identity(&final_path)? != op.directory_id
                || identity(&final_path.join("harness"))? != op.home_id || receipt(&final_path, &op)? != op.receipt_digest {
                return Err("IMPORT_ADOPTION_CONFLICT".into());
            }
            if op.phase == ImportPhase::Ready {
                if !tx.sweep()? { return Err("STORAGE_WRITER_ACTIVE".into()); }
                let home = final_path.join("harness");
                let mut seen = BTreeSet::new(); let mut total = 0;
                for path in EXCLUDED { measure(&home.join(path), &mut seen, &mut total)?; }
                op.retained_bytes = total;
                tx.state.homes.insert(home);
            }
            op.phase = ImportPhase::Adopted; tx.state.imports.insert(op.operation_id.clone(), op.clone()); tx.commit()?;
        },
        _ => return Err("STORAGE_ACTION_UNSUPPORTED".into()),
    }
    Ok(observe(tx, &op))
}

#[cfg(test)]
thread_local! { static STOP_PUBLICATION: std::cell::Cell<u8> = const { std::cell::Cell::new(0) }; }
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adopted_carrier_runtime_does_not_block_managed_scans() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("import-carrier-{}-{nonce}", std::process::id()));
        let home = root.join("home"); fs::create_dir_all(&home).unwrap();
        let id = "00000000-0000-0000-0000-000000000002";
        let request = |action: &str| serde_json::from_value(json!({"action":action,"ownerEpoch":"carrier-owner-000001",
            "pid":std::process::id(),"limitBytes":1048576,"safetyBytes":1048576,"operationId":id,
            "scope":"node:import","token":"carrier-token-000001","maxWriteBytes":65536,"fingerprint":"0".repeat(64)})).unwrap();
        super::super::dispatch(&home, request("open")).unwrap();
        super::super::dispatch(&home, request("import-start")).unwrap();
        let staging = root.join("imports").join(format!("{id}.pending"));
        fs::create_dir(staging.join("harness")).unwrap();
        let bytes = serde_json::to_vec(&json!({"status":"READY","operationId":id,"fingerprint":"0".repeat(64)})).unwrap();
        fs::write(staging.join("import.json"), &bytes).unwrap();
        super::super::dispatch(&home, request("import-publish")).unwrap();
        super::super::dispatch(&home, request("settle")).unwrap();
        super::super::dispatch(&home, request("import-adopt")).unwrap();
        let imported = root.join("imports").join(id);
        fs::create_dir(imported.join("harness/nidofy-extras")).unwrap();
        fs::write(imported.join("harness/nidofy-extras/note"), b"note").unwrap();
        fs::create_dir(imported.join("review")).unwrap();
        fs::write(imported.join("review/item"), b"review").unwrap();
        let carrier = root.join("imports").join(id).join("electron");
        fs::create_dir(&carrier).unwrap();
        fs::write(carrier.join("state.sqlite"), b"carrier bytes").unwrap();
        let held = OpenOptions::new().read(true).write(true).share_mode(0).open(carrier.join("state.sqlite")).unwrap();
        let result = super::super::dispatch(&home, request("recover")).unwrap();
        assert_eq!(result["measuredBytes"], bytes.len() as u64 + 4 + 6);
        drop(held);
        assert!(root.starts_with(std::env::temp_dir())); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn import_schema_matches_actual_serialization() {
        let schema: Value = serde_json::from_str(include_str!("../../quota.schema.json")).unwrap();
        let op = Import { operation_id:"id".into(),owner:ProcessIdentity{pid:1,creation:1},fingerprint:String::new(),
            directory_id:String::new(),home_id:String::new(),receipt_digest:String::new(),spent_bytes:0,retained_bytes:0,phase:ImportPhase::Copying };
        let actual = serde_json::to_value(op).unwrap();
        assert_eq!(actual.as_object().unwrap().keys().collect::<Vec<_>>(), schema["$defs"]["import"]["properties"].as_object().unwrap().keys().collect::<Vec<_>>());
        assert_eq!(serde_json::to_value(vec![ImportPhase::Copying,ImportPhase::Publishing,ImportPhase::Ready,ImportPhase::Interrupted,ImportPhase::Adopted]).unwrap(), schema["$defs"]["import"]["properties"]["phase"]["enum"]);
    }
    #[test]
    fn publication_reopens_both_sides_of_rename_without_copy_replay() {
        for point in [1, 2] {
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let root = std::env::temp_dir().join(format!("import-publication-{}-{nonce}",std::process::id()));
            let home = root.join("home"); fs::create_dir_all(&home).unwrap();
            let id = "00000000-0000-0000-0000-000000000001";
            let request = |action: &str| serde_json::from_value(json!({"action":action,"ownerEpoch":"import-owner-000001",
                "pid":std::process::id(),"limitBytes":1048576,"safetyBytes":1048576,"operationId":id,
                "scope":"node:import","token":"import-token-000001","maxWriteBytes":65536,"fingerprint":"0".repeat(64)})).unwrap();
            super::super::dispatch(&home, request("open")).unwrap();
            super::super::dispatch(&home, request("import-start")).unwrap();
            let staging = root.join("imports").join(format!("{id}.pending"));
            fs::create_dir(staging.join("harness")).unwrap();
            let receipt = serde_json::to_vec(&json!({"status":"READY","operationId":id,"fingerprint":"0".repeat(64)})).unwrap();
            fs::write(staging.join("import.json"), &receipt).unwrap();
            STOP_PUBLICATION.with(|fault| fault.set(point));
            assert_eq!(super::super::dispatch(&home, request("import-publish")).unwrap_err(), "IMPORT_TEST_STOP");
            let mut tx = Transaction::open(&home, None).unwrap();
            let mut op = tx.state.imports[id].clone(); assert!(op.phase == ImportPhase::Publishing);
            complete_publication(&mut tx, &mut op).unwrap(); drop(tx);
            let tx = Transaction::open(&home, None).unwrap(); assert!(tx.state.imports[id].phase == ImportPhase::Ready); drop(tx);
            assert_eq!(fs::read(root.join("imports").join(id).join("import.json")).unwrap(), receipt);
            assert!(!staging.exists()); assert!(root.starts_with(std::env::temp_dir())); fs::remove_dir_all(root).unwrap();
        }
    }
}
