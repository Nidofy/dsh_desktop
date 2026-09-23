use std::{os::windows::io::AsRawHandle, process::Child};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::*,
};

pub struct Job(HANDLE);
unsafe impl Send for Job {}
impl Job {
    pub fn new(child: &Child) -> Result<Self, String> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(job)
        }
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub struct Instance(HANDLE);
impl Instance {
    pub fn acquire() -> Option<Self> {
        Self::for_environment(crate::environments::id())
    }
    pub fn for_environment(environment:&str)->Option<Self>{
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        };
        let name: Vec<u16> = if environment=="stable"{"Local\\DSHDesktop-0.1\0".into()}else{format!("Local\\DSHDesktop-environment-{environment}\0")}.encode_utf16().collect();
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            if handle.is_null() {
                return None;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return None;
            }
            Some(Self(handle))
        }
    }
}
impl Drop for Instance {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    #[test]
    fn closing_job_reaps_backend_and_grandchild() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let mut child = Command::new(root.join("runtime/runtime/node.exe"))
            .arg(root.join("tests/descendant-probe.mjs"))
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let job = Job::new(&child).unwrap();
        child.stdin.as_mut().unwrap().write_all(b"start\n").unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let pid: u32 = line.trim().parse().unwrap();
        drop(job);
        child.wait().unwrap();
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let alive = unsafe {
                let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                if handle.is_null() {
                    false
                } else {
                    let mut code = 0;
                    let ok = GetExitCodeProcess(handle, &mut code);
                    CloseHandle(handle);
                    ok != 0 && code == 259
                }
            };
            if !alive {
                break;
            }
            assert!(Instant::now() < deadline, "Job left a live descendant");
            std::thread::sleep(Duration::from_millis(30));
        }
    }
}
