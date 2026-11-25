//! Native clipboard listener: a dedicated thread owning a message-only window that is registered
//! with `AddClipboardFormatListener`. Windows posts `WM_CLIPBOARDUPDATE` only when the clipboard
//! changes, so there is no polling. Dropping/stopping the listener removes the registration,
//! destroys the window and joins the thread.

#[cfg(windows)]
mod imp {
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        ptr,
        sync::mpsc,
        thread::{self, JoinHandle},
        time::Duration,
    };
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            DataExchange::{AddClipboardFormatListener, RemoveClipboardFormatListener},
            LibraryLoader::GetModuleHandleW,
        },
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, GetWindowLongPtrW, PostMessageW,
            PostQuitMessage, RegisterClassW, SetWindowLongPtrW, TranslateMessage, GWLP_USERDATA, HWND_MESSAGE, MSG, WM_APP,
            WNDCLASSW,
        },
    };

    const WM_CLIPBOARDUPDATE: u32 = 0x031D;
    const WM_STOP: u32 = WM_APP + 1;
    const CLASS_NAME: &str = "DoodleClipboardListener";

    struct Context {
        on_update: Box<dyn Fn() + Send>,
    }

    pub struct Listener {
        hwnd: isize,
        thread: Option<JoinHandle<()>>,
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_CLIPBOARDUPDATE => {
                let context = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Context;
                if !context.is_null() {
                    // A panic must never unwind across the FFI boundary.
                    let _ = catch_unwind(AssertUnwindSafe(|| ((*context).on_update)()));
                }
                0
            }
            WM_STOP => {
                RemoveClipboardFormatListener(hwnd);
                DestroyWindow(hwnd);
                0
            }
            m if m == windows_sys::Win32::UI::WindowsAndMessaging::WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    impl Listener {
        /// Starts the listener thread. `on_update` runs on that thread for every clipboard change.
        pub fn start(on_update: impl Fn() + Send + 'static) -> Result<Listener, String> {
            let (ready_tx, ready_rx) = mpsc::channel::<Result<isize, String>>();
            let thread = thread::Builder::new()
                .name("doodle-clipboard-listener".into())
                .spawn(move || run(Box::new(on_update), ready_tx))
                .map_err(|e| format!("could not start the clipboard listener thread: {e}"))?;
            match ready_rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Ok(hwnd)) => Ok(Listener { hwnd, thread: Some(thread) }),
                Ok(Err(error)) => {
                    let _ = thread.join();
                    Err(error)
                }
                Err(_) => Err("the clipboard listener did not start in time".into()),
            }
        }

        pub fn is_alive(&self) -> bool {
            self.thread.as_ref().map(|t| !t.is_finished()).unwrap_or(false)
        }

        /// Unregisters the listener and waits for its thread to finish.
        pub fn stop(&mut self) {
            if let Some(thread) = self.thread.take() {
                // SAFETY: posting to a window owned by our own thread; if it is already gone this just fails.
                unsafe { PostMessageW(self.hwnd as HWND, WM_STOP, 0, 0) };
                let _ = thread.join();
            }
        }
    }

    impl Drop for Listener {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn run(on_update: Box<dyn Fn() + Send>, ready: mpsc::Sender<Result<isize, String>>) {
        // SAFETY: standard message-only window creation; every pointer passed outlives its call and
        // the context pointer outlives the window (it is freed only after the message loop ends).
        unsafe {
            let instance = GetModuleHandleW(ptr::null());
            let class_name = wide(CLASS_NAME);
            let class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: ptr::null_mut(),
                hCursor: ptr::null_mut(),
                hbrBackground: ptr::null_mut(),
                lpszMenuName: ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };
            if RegisterClassW(&class) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS {
                let _ = ready.send(Err("could not register the clipboard listener window class".into()));
                return;
            }
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                ptr::null_mut(),
                instance,
                ptr::null(),
            );
            if hwnd.is_null() {
                let _ = ready.send(Err("could not create the clipboard listener window".into()));
                return;
            }
            let context = Box::into_raw(Box::new(Context { on_update }));
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, context as isize);

            if AddClipboardFormatListener(hwnd) == 0 {
                let _ = ready.send(Err("Windows refused the clipboard listener registration".into()));
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                DestroyWindow(hwnd);
                drop(Box::from_raw(context));
                return;
            }
            let _ = ready.send(Ok(hwnd as isize));

            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            drop(Box::from_raw(context));
        }
    }
}

#[cfg(windows)]
pub use imp::Listener;

#[cfg(not(windows))]
pub struct Listener;

#[cfg(not(windows))]
impl Listener {
    pub fn start(_on_update: impl Fn() + Send + 'static) -> Result<Listener, String> {
        Err("Clipboard monitoring is only available on Windows".into())
    }
    pub fn is_alive(&self) -> bool {
        false
    }
    pub fn stop(&mut self) {}
}
