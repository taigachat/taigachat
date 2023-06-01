use std::cell::RefCell;

#[cfg(windows)]
extern crate winapi;

#[cfg(not(windows))]
extern crate nix;

#[derive(Default)]
pub struct Keybinds {
    pub accept_all: bool,
    pub interested: Vec<u64>,
    pub mouse_clicks: usize,
}


pub struct KeyListener {
    pub sender: tokio::sync::broadcast::Sender<(u64, bool)>,
    pub keybinds: std::sync::Arc<std::sync::Mutex<Keybinds>>,
}

thread_local! {
    static KEYBOARD_LISTENER: RefCell<Option<KeyListener>> = RefCell::new(None)
}

pub struct KeyListenerTask {
    #[allow(dead_code)]
    thread_id: usize,
}

#[cfg(windows)]
const MAGIC_CLOSE_1: usize = 0xc110c605;

#[cfg(windows)]
const MAGIC_CLOSE_2: isize = 0x720f9e11;

impl KeyListenerTask {
    #[cfg(windows)]
    pub fn stop(&self) {
        unsafe {
            use winapi::um::winuser::*;
            PostThreadMessageW(self.thread_id as u32, WM_CLOSE, MAGIC_CLOSE_1, MAGIC_CLOSE_2);
        }
    }
    #[cfg(not(windows))]
    pub fn stop(&self) {}
}

pub fn get_yarn() -> &'static str {
    if cfg!(windows) {
        "yarn.cmd"
    } else {
        "yarn"
    }
}

pub fn get_npm() -> &'static str {
    // TODO: This has not actually been tested. But it should work...
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

/*fn i8_to_str<const L: usize>(source: [i8; L]) -> String {
    unsafe {
        let u = source.as_ptr() as *mut u8;
        let slice = std::slice::from_raw_parts(u, L);
        return String::from_utf8_lossy(slice).into();
    }
}*/

#[cfg(windows)]
unsafe extern "system" fn keyboard_callback(n_code: i32, w_param: winapi::shared::minwindef::WPARAM, l_param: winapi::shared::minwindef::LPARAM) -> winapi::shared::minwindef::LRESULT {
    use winapi::um::winuser::*;
    let key = l_param as PKBDLLHOOKSTRUCT;
    let w = w_param as winapi::shared::minwindef::UINT;
    if (w == WM_KEYDOWN || w == WM_KEYUP) && n_code == HC_ACTION {
        KEYBOARD_LISTENER.with(|channel| {
            let c = channel.borrow();
            let a = c.as_ref().unwrap();
            let mut bindings = a.keybinds.lock().unwrap();
            let code = (*key).scanCode;
            if bindings.interested.contains(&(code.into())) || bindings.accept_all {
                bindings.accept_all = false;
                _ = a.sender.send((code.into(), w == WM_KEYDOWN));
            }
        });
    }
    return CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param);
}

#[cfg(windows)]
unsafe extern "system" fn mouse_callback(n_code: i32, w_param: winapi::shared::minwindef::WPARAM, l_param: winapi::shared::minwindef::LPARAM) -> winapi::shared::minwindef::LRESULT {
    use winapi::um::winuser::*;
    let w = w_param as winapi::shared::minwindef::UINT;
    if w == WM_LBUTTONUP && n_code == HC_ACTION {
        KEYBOARD_LISTENER.with(|channel| {
            let c = channel.borrow();
            let a = c.as_ref().unwrap();
            let mut bindings = a.keybinds.lock().unwrap();
            bindings.mouse_clicks += 1;
        });
    }
    return CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param);
}


#[cfg(windows)]
pub async fn wait_for_keys(listener: KeyListener) -> KeyListenerTask {
    use winapi::um::winuser::*;
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        unsafe {
            _ = tx.send(winapi::um::processthreadsapi::GetCurrentThreadId() as usize);
        }
        KEYBOARD_LISTENER.with(move |channel| {
            channel.replace(Some(listener));
        });
        unsafe {
            let hook_kb = SetWindowsHookExA(WH_KEYBOARD_LL, Some(keyboard_callback), std::ptr::null_mut(), 0);
            let hook_ms = SetWindowsHookExA(WH_MOUSE_LL, Some(mouse_callback), std::ptr::null_mut(), 0);

            let mut msg = winapi::um::winuser::MSG::default();
            while GetMessageW(&mut msg,
                        std::ptr::null_mut(),
                        0,
                        0) == 1 {
                if msg.message == WM_CLOSE
                    && msg.wParam == MAGIC_CLOSE_1
                    && msg.lParam == MAGIC_CLOSE_2 {
                    break
                }
                TranslateMessage(&mut msg);
                DispatchMessageW(&mut msg);
            }
            if !hook_kb.is_null() {
                UnhookWindowsHookEx(hook_kb);
            }
            if !hook_ms.is_null() {
                UnhookWindowsHookEx(hook_ms);
            }
        }
    });
    let thread_id = rx.await.unwrap();
    return KeyListenerTask {
        thread_id,
    }
}

#[cfg(windows)]
pub fn kill_recursive(child: tokio::process::Child) {
    use winapi::shared::minwindef::DWORD;
    pub fn process_tree() -> std::collections::HashMap<DWORD, Vec<DWORD>> {
        let mut tree = std::collections::HashMap::new();
        unsafe {
            const FLAG: DWORD = winapi::um::tlhelp32::TH32CS_SNAPPROCESS;
            let handle = winapi::um::tlhelp32::CreateToolhelp32Snapshot(FLAG, 0);
            let mut process = winapi::um::tlhelp32::PROCESSENTRY32::default();
            process.dwSize = std::mem::size_of::<winapi::um::tlhelp32::PROCESSENTRY32>() as u32;
            if winapi::um::tlhelp32::Process32First(handle, &mut process) == 1 {
                tree.entry(process.th32ParentProcessID)
                    .or_insert(vec![])
                    .push(process.th32ProcessID);
                while winapi::um::tlhelp32::Process32Next(handle, &mut process) == 1 {
                    tree.entry(process.th32ParentProcessID)
                        .or_insert(vec![])
                        .push(process.th32ProcessID);
                }
            }
            winapi::um::handleapi::CloseHandle(handle);
        }

        tree
    }

    pub fn kill_deep_id(tree: &std::collections::HashMap<DWORD, Vec<DWORD>>, id: DWORD) {
        //println!("attempting to kill: {}", id);
        if let Some(children) = tree.get(&id) {
            for child in children {
                kill_deep_id(tree, *child);
            }
        }

        unsafe {
            let process = winapi::um::processthreadsapi::OpenProcess(winapi::um::winnt::PROCESS_TERMINATE, 0, id);
            winapi::um::processthreadsapi::TerminateProcess(process, 1);
            winapi::um::handleapi::CloseHandle(process);
        }
    }
    let tree = process_tree();
    kill_deep_id(&tree, child.id().unwrap() as DWORD);
}

#[cfg(not(windows))]
pub fn kill_deep_thread(id: nix::pty::SessionId, tid: nix::pty::SessionId) {
    let children = std::fs::read_to_string(format!("/proc/{}/task/{}/children", id, tid)).unwrap();
    for id in children.split(' ') {
        if id != "" {
            kill_deep_id(id.parse().unwrap());
        }
    }
}

#[cfg(not(windows))]
pub fn kill_deep_id(id: nix::pty::SessionId) {
    let dir = std::fs::read_dir(format!("/proc/{}/task", id)).unwrap();
    for e in dir {
        let child: nix::pty::SessionId = e.unwrap().file_name().into_string().unwrap().parse().unwrap();
        kill_deep_thread(id, child);
    }
    let pid = nix::unistd::Pid::from_raw(id);
    if let Err(e) = nix::sys::signal::kill(pid, nix::sys::signal::SIGKILL) {
        println!("{}", e);
    }
}
#[cfg(not(windows))]
pub fn kill_recursive(child: tokio::process::Child) {
    kill_deep_id(child.id().unwrap() as nix::pty::SessionId);
}

pub fn set_as_executable(path: std::path::PathBuf) -> anyhow::Result<()> {
    //println!("set as executable called {path:#?}");
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, PermissionsExt::from_mode(0o755))?; 
    }
    #[cfg(windows)]
    {
        _ = path;
    }
    Ok(())
}

#[cfg(not(windows))]
pub async fn wait_for_keys(_listener: KeyListener) -> KeyListenerTask {
    return KeyListenerTask {
        thread_id: 0,
    }
}

#[cfg(windows)]
pub fn set_proper_executable_extension(mut path: std::path::PathBuf) -> std::path::PathBuf {
    // TODO: Refactor away set_proper_executable_extension
    path.set_extension("exe");
    path
}

#[cfg(not(windows))]
pub fn set_proper_executable_extension(path: std::path::PathBuf) -> std::path::PathBuf {
    path
}

pub fn get_platform_specific_app_dir(app_name: &str) -> Option<std::path::PathBuf> {
    let app_name = if cfg!(windows) {
        app_name.to_owned()
    } else {
        app_name.to_owned().to_ascii_lowercase()
    };

    if let Some(mut data_dir) = dirs::data_local_dir() {
        data_dir.push(app_name);
        Some(data_dir)
    } else {
        None
    }
}

#[cfg(windows)]
pub fn simple_popup(title: &str, caption: &str) {
    let title_c = std::ffi::CString::new(title).unwrap();
    let caption_c = std::ffi::CString::new(caption).unwrap();
    const FLAG: u32 = winapi::um::winuser::MB_OK |
                      winapi::um::winuser::MB_ICONINFORMATION;
    tokio::task::spawn_blocking(move || {
        unsafe {
            winapi::um::winuser::MessageBoxA(std::ptr::null_mut(),
                                             caption_c.as_ptr() as *const i8,
                                             title_c.as_ptr() as *const i8,
                                             FLAG);
        }
    });
}

#[cfg(not(windows))]
pub fn simple_popup(_title: &str, _caption: &str) {
}

// WARNING: this function is probably slow.
#[cfg(windows)]
pub fn client_in_focus(process_id: u32) -> bool {
    unsafe {
        use winapi::shared::minwindef::DWORD;
        let handle = winapi::um::winuser::GetForegroundWindow();
        let mut id: DWORD = 0;
        winapi::um::winuser::GetWindowThreadProcessId(handle, &mut id);

        if process_id == id {
            return true
        }

        // We must get all the parents of all the processes
        // because of how the win32 api works.
        // Then we can scan this.
        // Perhaps there is a more efficient way, but I am
        // too tired to find it.
        let mut parents = std::collections::HashMap::new();
        const FLAG: DWORD = winapi::um::tlhelp32::TH32CS_SNAPPROCESS;
        let handle = winapi::um::tlhelp32::CreateToolhelp32Snapshot(FLAG, 0);
        let mut process = winapi::um::tlhelp32::PROCESSENTRY32::default();
        process.dwSize = std::mem::size_of::<winapi::um::tlhelp32::PROCESSENTRY32>() as u32;
        if winapi::um::tlhelp32::Process32First(handle, &mut process) == 1 {
            parents.insert(process.th32ProcessID, process.th32ParentProcessID);
            while winapi::um::tlhelp32::Process32Next(handle, &mut process) == 1 {
                parents.insert(process.th32ProcessID, process.th32ParentProcessID);
            }
        }
        winapi::um::handleapi::CloseHandle(handle);

        // We walk upwards until process_id is found.
        while let Some(parent_id) = parents.get(&id) {
            if *parent_id == process_id {
                return true;
            }
            id = *parent_id;
        }
    }
    return false
}

#[cfg(not(windows))]
pub fn client_in_focus(_process_id: u32) -> bool {
    return false
}

#[cfg(windows)]
pub fn client_minimize() {
    unsafe {
        let handle = winapi::um::winuser::GetForegroundWindow();
        winapi::um::winuser::ShowWindow(handle, winapi::um::winuser::SW_MINIMIZE);
    }
}

#[cfg(not(windows))]
pub fn client_minimize() {
    println!("client_minimize() not implemented on this platform yet!");
}

#[cfg(windows)]
pub fn client_maximize() {
    unsafe {
        let handle = winapi::um::winuser::GetForegroundWindow();
        winapi::um::winuser::ShowWindow(handle, winapi::um::winuser::SW_SHOWMAXIMIZED);
    }
}

#[cfg(not(windows))]
pub fn client_maximize() {
    println!("client_minimize() not implemented on this platform yet!");
}
