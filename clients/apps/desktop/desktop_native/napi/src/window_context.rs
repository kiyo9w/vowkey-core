#[napi(object)]
#[derive(Debug, Clone)]
pub struct ForegroundWindowInfo {
    pub hwnd: String,
    pub app: String,
    pub exe_path: String,
    pub window_title: String,
}

pub(crate) fn parse_hwnd_isize(raw: &str) -> Option<isize> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let val = if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        usize::from_str_radix(hex, 16).ok()? as isize
    } else {
        trimmed.parse::<isize>().ok()?
    };
    (val != 0).then_some(val)
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn app_display_name_from_exe(exe_path: &str) -> String {
    let file_name = exe_path.rsplit(['\\', '/']).next().unwrap_or("");
    let stem = file_name
        .strip_suffix(".exe")
        .or_else(|| file_name.strip_suffix(".EXE"))
        .unwrap_or(file_name);
    stem.to_string()
}

#[cfg(target_os = "windows")]
mod imp {
    use std::{ffi::c_void, thread, time::Duration};

    use windows::{
        core::{BOOL, PCWSTR, PWSTR},
        Win32::{
            Foundation::{CloseHandle, GlobalFree, HANDLE, HGLOBAL, HWND, LPARAM},
            Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            System::{
                DataExchange::{
                    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW,
                    SetClipboardData,
                },
                Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
                Threading::{
                    AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId, OpenProcess,
                    QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                    PROCESS_QUERY_LIMITED_INFORMATION,
                },
            },
            UI::WindowsAndMessaging::{
                BringWindowToTop, EnumChildWindows, EnumWindows, GetForegroundWindow, GetWindow,
                GetWindowLongW, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
                IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow, GWL_EXSTYLE,
                GW_OWNER, SW_RESTORE, WS_EX_TOOLWINDOW,
            },
        },
    };

    use super::{app_display_name_from_exe, parse_hwnd_isize, ForegroundWindowInfo};

    const CF_UNICODETEXT_ID: u32 = 13;
    const APPLICATION_FRAME_HOST: &str = "ApplicationFrameHost.exe";

    struct EnumExternalCtx {
        self_pid: u32,
        found: Option<(HWND, u32)>,
    }

    struct ChildPidCtx {
        frame_pid: u32,
        found_pid: u32,
    }

    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked: u32 = 0;
        let res = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                (&mut cloaked as *mut u32).cast::<c_void>(),
                std::mem::size_of_val(&cloaked) as u32,
            )
        };
        res.is_ok() && cloaked != 0
    }

    unsafe extern "system" fn enum_external_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut EnumExternalCtx) };
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() || is_cloaked(hwnd) {
            return BOOL(1);
        }
        if unsafe { GetWindowTextLengthW(hwnd) } <= 0 {
            return BOOL(1);
        }
        let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
            return BOOL(1);
        }
        if let Ok(owner) = unsafe { GetWindow(hwnd, GW_OWNER) } {
            if !owner.0.is_null() {
                return BOOL(1);
            }
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 || pid == ctx.self_pid {
            return BOOL(1);
        }
        ctx.found = Some((hwnd, pid));
        BOOL(0)
    }

    unsafe extern "system" fn enum_child_pid_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut ChildPidCtx) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid != 0 && pid != ctx.frame_pid {
            ctx.found_pid = pid;
            return BOOL(0);
        }
        BOOL(1)
    }

    fn resolve_child_pid(parent: HWND, frame_pid: u32) -> Option<u32> {
        let mut ctx = ChildPidCtx {
            frame_pid,
            found_pid: 0,
        };
        let _ = unsafe {
            EnumChildWindows(
                Some(parent),
                Some(enum_child_pid_proc),
                LPARAM(&mut ctx as *mut ChildPidCtx as isize),
            )
        };
        (ctx.found_pid != 0).then_some(ctx.found_pid)
    }

    fn query_process_exe_path(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let res = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            )
        };
        let _ = unsafe { CloseHandle(handle) };
        res.ok()?;
        let slice = buf.get(..size as usize)?;
        Some(String::from_utf16_lossy(slice))
    }

    fn read_window_title(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let cap = (len as usize).saturating_add(1);
        let mut buf = vec![0u16; cap];
        let written = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if written <= 0 {
            return String::new();
        }
        let slice = buf.get(..written as usize).unwrap_or(&[]);
        String::from_utf16_lossy(slice)
    }

    pub(super) fn get_foreground_window_info() -> Option<ForegroundWindowInfo> {
        let self_pid = unsafe { GetCurrentProcessId() };
        let fg = unsafe { GetForegroundWindow() };
        let mut target: Option<(HWND, u32)> = None;

        if !fg.0.is_null() {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(fg, Some(&mut pid)) };
            if pid != 0 && pid != self_pid {
                target = Some((fg, pid));
            }
        }

        if target.is_none() {
            let mut ctx = EnumExternalCtx {
                self_pid,
                found: None,
            };
            let _ = unsafe {
                EnumWindows(
                    Some(enum_external_window_proc),
                    LPARAM(&mut ctx as *mut EnumExternalCtx as isize),
                )
            };
            target = ctx.found;
        }

        let (hwnd, mut pid) = target?;
        let mut exe_path = query_process_exe_path(pid).unwrap_or_default();
        if exe_path
            .rsplit(['\\', '/'])
            .next()
            .is_some_and(|f| f.eq_ignore_ascii_case(APPLICATION_FRAME_HOST))
        {
            if let Some(child_pid) = resolve_child_pid(hwnd, pid) {
                pid = child_pid;
                if let Some(child_exe) = query_process_exe_path(pid) {
                    exe_path = child_exe;
                }
            }
        }

        let window_title = read_window_title(hwnd);
        let app = app_display_name_from_exe(&exe_path);

        Some(ForegroundWindowInfo {
            hwnd: (hwnd.0 as isize).to_string(),
            app,
            exe_path,
            window_title,
        })
    }

    pub(super) fn focus_external_window(hwnd_str: &str) -> bool {
        let Some(raw) = parse_hwnd_isize(hwnd_str) else {
            return false;
        };
        let target = HWND(raw as *mut c_void);
        if !unsafe { IsWindow(Some(target)) }.as_bool() {
            return false;
        }

        unsafe {
            if IsIconic(target).as_bool() {
                let _ = ShowWindow(target, SW_RESTORE);
            }

            let cur_tid = GetCurrentThreadId();
            let fg_hwnd = GetForegroundWindow();
            let fg_tid = if fg_hwnd.0.is_null() {
                0
            } else {
                GetWindowThreadProcessId(fg_hwnd, None)
            };
            let target_tid = GetWindowThreadProcessId(target, None);

            let attached_fg = fg_tid != 0
                && fg_tid != cur_tid
                && AttachThreadInput(cur_tid, fg_tid, true).as_bool();
            let attached_target = target_tid != 0
                && target_tid != cur_tid
                && target_tid != fg_tid
                && AttachThreadInput(cur_tid, target_tid, true).as_bool();

            let _ = BringWindowToTop(target);
            let focused = SetForegroundWindow(target).as_bool();

            if attached_target {
                let _ = AttachThreadInput(cur_tid, target_tid, false);
            }
            if attached_fg {
                let _ = AttachThreadInput(cur_tid, fg_tid, false);
            }

            focused || GetForegroundWindow() == target
        }
    }

    unsafe fn alloc_clipboard_bytes(bytes: &[u8]) -> Option<HGLOBAL> {
        let hmem = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }.ok()?;
        let ptr = unsafe { GlobalLock(hmem) };
        if ptr.is_null() {
            let _ = unsafe { GlobalFree(Some(hmem)) };
            return None;
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.cast::<u8>(), bytes.len());
            let _ = GlobalUnlock(hmem);
        }
        Some(hmem)
    }

    unsafe fn set_clipboard_dword_format(format_name: &str, value: u32) {
        let wide: Vec<u16> = format_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let fmt = unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) };
        if fmt == 0 {
            return;
        }
        if let Some(hmem) = unsafe { alloc_clipboard_bytes(&value.to_le_bytes()) } {
            if unsafe { SetClipboardData(fmt, Some(HANDLE(hmem.0))) }.is_err() {
                let _ = unsafe { GlobalFree(Some(hmem)) };
            }
        }
    }

    pub(super) fn write_concealed_clipboard(text: &str) -> bool {
        let mut opened = false;
        for attempt in 0..5 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                opened = true;
                break;
            }
            if attempt < 4 {
                thread::sleep(Duration::from_millis(10));
            }
        }
        if !opened {
            return false;
        }

        let ok = unsafe {
            if EmptyClipboard().is_err() {
                let _ = CloseClipboard();
                return false;
            }

            let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let byte_len = utf16.len() * std::mem::size_of::<u16>();
            let text_bytes = std::slice::from_raw_parts(utf16.as_ptr().cast::<u8>(), byte_len);

            let Some(hmem) = alloc_clipboard_bytes(text_bytes) else {
                let _ = CloseClipboard();
                return false;
            };

            let set_ok = if SetClipboardData(CF_UNICODETEXT_ID, Some(HANDLE(hmem.0))).is_ok() {
                true
            } else {
                let _ = GlobalFree(Some(hmem));
                false
            };

            if set_ok {
                set_clipboard_dword_format("ExcludeClipboardContentFromMonitorProcessing", 1);
                set_clipboard_dword_format("CanIncludeInClipboardHistory", 0);
                set_clipboard_dword_format("CanUploadToCloudClipboard", 0);
            }

            let _ = CloseClipboard();
            set_ok
        };

        ok
    }
}

#[napi]
pub fn get_foreground_window_info() -> Option<ForegroundWindowInfo> {
    #[cfg(target_os = "windows")]
    {
        imp::get_foreground_window_info()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[napi]
pub fn focus_external_window(hwnd: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        imp::focus_external_window(&hwnd)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = parse_hwnd_isize(&hwnd);
        false
    }
}

#[napi]
pub fn write_concealed_clipboard(text: String) -> bool {
    #[cfg(target_os = "windows")]
    {
        imp::write_concealed_clipboard(&text)
    }
    #[cfg(not(target_os = "windows"))]
    {
        desktop_core::clipboard::write_sync(&text, true).is_ok()
    }
}

#[napi]
pub mod window_info {
    use super::ForegroundWindowInfo;

    #[napi]
    pub fn get_foreground_window_info() -> Option<ForegroundWindowInfo> {
        super::get_foreground_window_info()
    }

    #[napi]
    pub fn focus_external_window(hwnd: String) -> bool {
        super::focus_external_window(hwnd)
    }
}

#[cfg(test)]
mod tests {
    use super::{app_display_name_from_exe, parse_hwnd_isize};

    #[test]
    fn parses_decimal_and_hex_hwnd_strings() {
        assert_eq!(parse_hwnd_isize("131248"), Some(131_248));
        assert_eq!(parse_hwnd_isize("  0x200b0 "), Some(0x200b0));
        assert_eq!(parse_hwnd_isize("0"), None);
        assert_eq!(parse_hwnd_isize(""), None);
        assert_eq!(parse_hwnd_isize("not-a-handle"), None);
    }

    #[test]
    fn extracts_app_name_from_windows_exe_path() {
        assert_eq!(
            app_display_name_from_exe(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            "chrome"
        );
        assert_eq!(
            app_display_name_from_exe(r"C:\Windows\System32\NOTEPAD.EXE"),
            "NOTEPAD"
        );
    }
}
