use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
#[derive(Clone)]
pub struct Logs(pub PathBuf);
impl Logs {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        let dir = root.join("logs");
        fs::create_dir_all(&dir)?;
        for name in ["desktop.log", "dsh.stdout.log", "dsh.stderr.log"] {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(name))?;
        }
        Ok(Self(dir))
    }
    // Callers pass only controlled metadata, never raw backend lines, credentials,
    // URLs with queries, prompts, source code or provider error bodies.
    pub fn write(&self, file: &str, message: &str) {
        let path = self.0.join(file);
        if fs::metadata(&path)
            .map(|m| m.len() > 2_000_000)
            .unwrap_or(false)
        {
            let _ = fs::rename(&path, path.with_extension("previous.log"));
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let _ = writeln!(f, "{now} UTC-epoch-ms {message}");
        }
    }
}
