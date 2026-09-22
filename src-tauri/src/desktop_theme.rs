use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub preference: String,
    pub font_size: u8,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            preference: "system".into(),
            font_size: 14,
        }
    }
}
#[cfg(test)]
pub fn load(root: &Path) -> Result<Appearance, String> {
    load_home(&root.join("dsh"))
}
pub fn load_home(home: &Path) -> Result<Appearance, String> {
    // A sanitized read-only mirror of DSH ui-theme, never a second preference store.
    let path = home.join("desktop-appearance.json");
    if !path.exists() {
        return Ok(Appearance::default());
    }
    if fs::metadata(&path)
        .map_err(|_| "Cannot inspect appearance")?
        .len()
        > 4096
    {
        return Err("Appearance mirror is too large".into());
    }
    let value: Appearance =
        serde_json::from_slice(&fs::read(path).map_err(|_| "Cannot read appearance")?)
            .map_err(|_| "Invalid appearance mirror")?;
    if !matches!(value.preference.as_str(), "light" | "dark" | "system")
        || !(12..=17).contains(&value.font_size)
    {
        return Err("Invalid appearance values".into());
    }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_shell_reads_only_validated_dsh_appearance() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".build/native-appearance-test");
        fs::create_dir_all(root.join("dsh")).unwrap();
        let file = root.join("dsh/desktop-appearance.json");
        for preference in ["light", "dark", "system"] {
            fs::write(
                &file,
                format!(r#"{{"preference":"{preference}","fontSize":16}}"#),
            )
            .unwrap();
            assert_eq!(
                load(&root).unwrap(),
                Appearance {
                    preference: preference.into(),
                    font_size: 16
                }
            );
        }
        fs::write(&file, r#"{"preference":"custom-css","fontSize":16}"#).unwrap();
        assert!(load(&root).is_err());
        fs::write(&file, r#"{"preference":"dark","fontSize":200}"#).unwrap();
        assert!(load(&root).is_err());
        fs::remove_file(&file).unwrap();
        assert_eq!(load(&root).unwrap(), Appearance::default());
    }
}
