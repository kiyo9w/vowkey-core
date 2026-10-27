// MVP, delete with PM-41067

//! Types text into the focused field of the app in front by posting keyboard events, the way
//! 1Password's Universal Autofill does. macOS lets an app post keyboard events once the person
//! has allowed it under System Settings › Privacy & Security › Accessibility; the first attempt
//! shows the system's own prompt.

use std::{ffi::c_void, thread, time::Duration};

use anyhow::{anyhow, Result};

type CFTypeRef = *const c_void;
type CGEventRef = *mut c_void;
type CGEventSourceRef = *mut c_void;

const KCG_HID_EVENT_TAP: u32 = 0;
const KCG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: i32 = 1;
/// Events carry at most this many UTF-16 units; longer text is sent in pieces.
const CHUNK: usize = 16;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGEventSourceCreate(state: i32) -> CGEventSourceRef;
    fn CGEventCreateKeyboardEvent(source: CGEventSourceRef, key: u16, down: bool) -> CGEventRef;
    fn CGEventKeyboardSetUnicodeString(event: CGEventRef, length: usize, string: *const u16);
    fn CGEventSetFlags(event: CGEventRef, flags: u64);
    fn CGEventPost(tap: u32, event: CGEventRef);
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    static kAXTrustedCheckOptionPrompt: CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: CFTypeRef);
    fn CFDictionaryCreate(
        allocator: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFTypeRef;
    static kCFBooleanTrue: CFTypeRef;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}

/// Whether Vowkey may post keyboard events; asks macOS to show its prompt when it may not.
fn accessibility_allowed() -> bool {
    // SAFETY: the dictionary holds two constant CoreFoundation objects and is released below.
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let options = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        );
        let allowed = AXIsProcessTrustedWithOptions(options);
        if !options.is_null() {
            CFRelease(options);
        }
        allowed
    }
}

/// The app in front is the one the text goes to; its title is not needed on macOS.
pub fn get_foreground_window_title() -> Result<String> {
    Ok(String::new())
}

/// Types `input` (UTF-16) into the focused field. `_keyboard_shortcut` names the keys the person is
/// still holding from the shortcut; the events are posted with no modifier flags so those keys do
/// not change what is typed.
pub fn type_input(input: &[u16], _keyboard_shortcut: &[String]) -> Result<()> {
    if !accessibility_allowed() {
        return Err(anyhow!(
            "Allow Vowkey under System Settings › Privacy & Security › Accessibility to type into other apps."
        ));
    }
    // SAFETY: every event created here is posted and released before the next one is made.
    unsafe {
        let source = CGEventSourceCreate(KCG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE);
        for chunk in input.chunks(CHUNK) {
            for down in [true, false] {
                let event = CGEventCreateKeyboardEvent(source, 0, down);
                if event.is_null() {
                    if !source.is_null() {
                        CFRelease(source as CFTypeRef);
                    }
                    return Err(anyhow!("macOS did not create a keyboard event."));
                }
                CGEventSetFlags(event, 0);
                CGEventKeyboardSetUnicodeString(event, chunk.len(), chunk.as_ptr());
                CGEventPost(KCG_HID_EVENT_TAP, event);
                CFRelease(event as CFTypeRef);
            }
            thread::sleep(Duration::from_millis(4));
        }
        if !source.is_null() {
            CFRelease(source as CFTypeRef);
        }
    }
    Ok(())
}
