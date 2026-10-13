//! One bounded command over inherited private pipes; never an HTTP listener or Agent engine.
mod task_snapshots;
mod quota;
use std::{io::{self, Read}, path::PathBuf};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Command {
    Quota { request: quota::Request },
    Authorized { command: Box<Command>, lease: quota::Capability },
    Ui { request: task_snapshots::Request },
    Resolve { workspace: PathBuf },
    Begin { workspace: PathBuf, binding: task_snapshots::TaskBinding, #[serde(rename="expiresAt")] expires_at: u64 },
    End { id: String, binding: task_snapshots::TaskBinding, #[serde(rename="expiresAt")] expires_at: u64 },
    Check { id: String, binding: task_snapshots::TaskBinding },
}
fn run() -> Result<serde_json::Value, String> {
    let home = std::env::args_os().nth(1).map(PathBuf::from).ok_or("home required")?;
    let mut bytes = Vec::new();
    io::stdin().take(65537).read_to_end(&mut bytes).map_err(|_| "read failed")?;
    if bytes.len() > 65536 { return Err("request too large".into()); }
    let command: Command = serde_json::from_slice(&bytes).map_err(|_| "invalid command")?;
    execute(&home, command, false)
}
fn execute(home: &std::path::Path, command: Command, authorized: bool) -> Result<serde_json::Value, String> {
    let requirement = match &command {
        Command::Begin {..} => Some(("native:task", 34*1024*1024, false)),
        Command::End {..} => Some(("native:task", 1024*1024, true)),
        Command::Ui {request} => request.storage_reservation().map(|bytes| (request.storage_scope(), bytes, false)),
        _ => None,
    };
    if requirement.is_some() && !authorized { return Err("STORAGE_LEASE_REQUIRED".into()); }
    match command {
        Command::Quota {request} => quota::dispatch(home, request),
        Command::Authorized {command, lease} => {
            let requirement = match command.as_ref() {
                Command::Begin {..} => Some(("native:task", 34*1024*1024, false)),
                Command::End {..} => Some(("native:task", 1024*1024, true)),
                Command::Ui {request} => request.storage_reservation().map(|bytes| (request.storage_scope(), bytes, false)),
                _ => None,
            }.ok_or("STORAGE_COMMAND_REFUSED")?;
            quota::consume(home, lease, requirement.0, requirement.1, requirement.2)?;
            execute(home, *command, true)
        },
        Command::Ui { request } => task_snapshots::dispatch(&home, request),
        Command::Resolve { workspace } => task_snapshots::admission(&home, &workspace),
        Command::Begin { workspace, binding, expires_at } => task_snapshots::begin(&home, &workspace, binding, expires_at),
        Command::End { id, binding, expires_at } => {
            task_snapshots::Store::open(&home)?.seal_task(&id, &binding, expires_at)?;
            Ok(serde_json::json!({"status":"SEALED"}))
        },
        Command::Check { id, binding } => {
            task_snapshots::check(&home, &id, &binding)?;
            Ok(serde_json::json!({"status":"CONFIRMED"}))
        },
    }
}
fn main() {
    let output = match run() {
        Ok(value) => serde_json::json!({"ok":true,"value":value}),
        Err(error) => serde_json::json!({"ok":false,"error":if error.starts_with("STORAGE_") || error.starts_with("IMPORT_")
            || error == "PROTECTION_ARCHIVE_PREVIEW_CONFLICT" { error } else { "PROTECTION_UNAVAILABLE".into() }}),
    };
    println!("{}", output);
}
