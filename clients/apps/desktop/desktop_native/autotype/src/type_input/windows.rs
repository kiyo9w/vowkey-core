//! Windows implementation of typing input into the foreground application.
//!
//! Copied from the MVP implementation (`mvp/windows/type_input.rs` plus the shared error helper and
//! modifier-key mapping it relied on) so the real crate does not depend on the MVP module, which is
//! removed with PM-41067. The `mockall` trait layering is kept as-is so the vetted unit tests port
//! over unchanged; a house-style de-mockall is a possible later cleanup.

use anyhow::{anyhow, Result};
use tracing::{debug, error};
use windows::Win32::{
    Foundation::{GetLastError, WIN32_ERROR},
    UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VIRTUAL_KEY,
    },
};

const IS_VIRTUAL_KEY: bool = true;
const IS_REAL_KEY: bool = false;

// Electron / W3C modifier keys
// <https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#cross-platform-modifiers>
const CONTROL_KEY_STR: &str = "Control";
const CONTROL_LEFT_KEY_STR: &str = "ControlLeft";
const CONTROL_RIGHT_KEY_STR: &str = "ControlRight";
const ALT_KEY_STR: &str = "Alt";
const ALT_LEFT_KEY_STR: &str = "AltLeft";
const ALT_RIGHT_KEY_STR: &str = "AltRight";
const SUPER_KEY_STR: &str = "Super";
const META_KEY_STR: &str = "Meta";
const META_LEFT_KEY_STR: &str = "MetaLeft";
const META_RIGHT_KEY_STR: &str = "MetaRight";
const SHIFT_KEY_STR: &str = "Shift";
const SHIFT_LEFT_KEY_STR: &str = "ShiftLeft";
const SHIFT_RIGHT_KEY_STR: &str = "ShiftRight";

// Win32 virtual-key codes for modifier keys
const CONTROL_KEY: u16 = 0x11;
const CONTROL_LEFT_KEY: u16 = 0xA2;
const CONTROL_RIGHT_KEY: u16 = 0xA3;
const ALT_KEY: u16 = 0x12;
const ALT_LEFT_KEY: u16 = 0xA4;
const ALT_RIGHT_KEY: u16 = 0xA5;
const SUPER_KEY: u16 = 0x5B;
const SUPER_RIGHT_KEY: u16 = 0x5C;
const SHIFT_KEY: u16 = 0x10;
const SHIFT_LEFT_KEY: u16 = 0xA0;
const SHIFT_RIGHT_KEY: u16 = 0xA1;

/// A mapping of <Electron modifier key string> to <numeric representation>
static MODIFIER_KEYS: [(&str, u16); 13] = [
    (CONTROL_KEY_STR, CONTROL_KEY),
    (CONTROL_LEFT_KEY_STR, CONTROL_LEFT_KEY),
    (CONTROL_RIGHT_KEY_STR, CONTROL_RIGHT_KEY),
    (ALT_KEY_STR, ALT_KEY),
    (ALT_LEFT_KEY_STR, ALT_LEFT_KEY),
    (ALT_RIGHT_KEY_STR, ALT_RIGHT_KEY),
    (SUPER_KEY_STR, SUPER_KEY),
    (META_KEY_STR, SUPER_KEY),
    (META_LEFT_KEY_STR, SUPER_KEY),
    (META_RIGHT_KEY_STR, SUPER_RIGHT_KEY),
    (SHIFT_KEY_STR, SHIFT_KEY),
    (SHIFT_LEFT_KEY_STR, SHIFT_LEFT_KEY),
    (SHIFT_RIGHT_KEY_STR, SHIFT_RIGHT_KEY),
];

/// Provides a mapping of the valid modifier keys' electron
/// string representation to the numeric representation.
fn get_numeric_modifier_key(modifier: &str) -> Option<u16> {
    for (modifier_str, modifier_num) in MODIFIER_KEYS {
        if modifier_str == modifier {
            return Some(modifier_num);
        }
    }
    None
}

/// `ErrorOperations` provides an interface to the Win32 API for dealing with
/// win32 errors.
#[cfg_attr(test, mockall::automock)]
trait ErrorOperations {
    /// <https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror>
    fn get_last_error() -> WIN32_ERROR {
        let last_err = unsafe { GetLastError() };
        debug!("GetLastError(): {}", last_err.to_hresult().message());
        last_err
    }
}

/// Default implementation for Win32 API errors.
struct Win32ErrorOperations;
impl ErrorOperations for Win32ErrorOperations {}

/// `KeyboardShortcutInput` is an `INPUT` of one of the valid shortcut keys:
///     - Control
///     - Alt
///     - Super
///     - \[a-z\]\[A-Z\]
struct KeyboardShortcutInput(INPUT);

/// `InputOperations` provides an interface to Window32 API for
/// working with inputs.
#[cfg_attr(test, mockall::automock)]
trait InputOperations {
    /// Attempts to type the provided input wherever the user's cursor is.
    ///
    /// <https://learn.microsoft.com/en-in/windows/win32/api/winuser/nf-winuser-sendinput>
    fn send_input(inputs: &[INPUT]) -> u32;
}

struct Win32InputOperations;

impl InputOperations for Win32InputOperations {
    fn send_input(inputs: &[INPUT]) -> u32 {
        const INPUT_STRUCT_SIZE: usize = std::mem::size_of::<INPUT>();

        let size = i32::try_from(INPUT_STRUCT_SIZE).expect("INPUT size to fit in i32");

        let insert_count = unsafe { SendInput(inputs, size) };

        debug!(insert_count, "SendInput() called.");

        insert_count
    }
}

/// Attempts to type the input text wherever the user's cursor is.
///
/// `input` is a slice of utf-16 encoded characters to insert.
/// `keyboard_shortcut` is a slice of valid shortcut keys (Control, Alt, Super, \[a-z\]\[A-Z\]).
pub(super) fn type_input(input: &[u16], keyboard_shortcut: &[String]) -> Result<()> {
    debug!(?keyboard_shortcut, "type_input() called.");

    // convert the raw string input to Windows input and error
    // if any key is not a valid keyboard shortcut input
    let keyboard_shortcut: Vec<KeyboardShortcutInput> = keyboard_shortcut
        .iter()
        .map(|s| KeyboardShortcutInput::try_from(s.as_str()))
        .collect::<Result<Vec<_>>>()?;

    type_input_inner(input, &keyboard_shortcut)
}

/// Builds the key down/up input sequence (the shortcut keys to release, then the text) and sends
/// it.
///
/// <https://learn.microsoft.com/en-in/windows/win32/api/winuser/nf-winuser-sendinput>
fn type_input_inner(input: &[u16], keyboard_shortcut: &[KeyboardShortcutInput]) -> Result<()> {
    // the length of this vec is always shortcut keys to release + (2x length of input chars)
    let mut keyboard_inputs: Vec<INPUT> =
        Vec::with_capacity(keyboard_shortcut.len() + (input.len() * 2));

    // insert the keyboard shortcut
    for shortcut in keyboard_shortcut {
        keyboard_inputs.push(shortcut.0);
    }

    add_input(input, &mut keyboard_inputs);

    send_input::<Win32InputOperations, Win32ErrorOperations>(&keyboard_inputs)
}

// Add key "down" and "up" inputs for the input
fn add_input(input: &[u16], keyboard_inputs: &mut Vec<INPUT>) {
    const TAB_KEY: u16 = 0x0009;
    const CR_KEY: u16 = 0x000D;
    const LF_KEY: u16 = 0x000A;
    const VK_RETURN_CODE: u16 = 0x0D;

    let mut idx = 0;
    while idx < input.len() {
        let code = input[idx];
        if code == TAB_KEY {
            keyboard_inputs.push(build_virtual_key_input(InputKeyPress::Down, TAB_KEY));
            keyboard_inputs.push(build_virtual_key_input(InputKeyPress::Up, TAB_KEY));
            idx += 1;
        } else if code == CR_KEY {
            keyboard_inputs.push(build_virtual_key_input(InputKeyPress::Down, VK_RETURN_CODE));
            keyboard_inputs.push(build_virtual_key_input(InputKeyPress::Up, VK_RETURN_CODE));
            if idx + 1 < input.len() && input[idx + 1] == LF_KEY {
                idx += 2;
            } else {
                idx += 1;
            }
        } else if code == LF_KEY {
            keyboard_inputs.push(build_virtual_key_input(InputKeyPress::Down, VK_RETURN_CODE));
            keyboard_inputs.push(build_virtual_key_input(InputKeyPress::Up, VK_RETURN_CODE));
            idx += 1;
        } else {
            keyboard_inputs.push(build_unicode_input(InputKeyPress::Down, code));
            keyboard_inputs.push(build_unicode_input(InputKeyPress::Up, code));
            idx += 1;
        }
    }
}

impl TryFrom<&str> for KeyboardShortcutInput {
    type Error = anyhow::Error;

    fn try_from(key: &str) -> std::result::Result<Self, Self::Error> {
        // not modifier key
        if key.len() == 1 {
            let input = build_unicode_input(InputKeyPress::Up, get_alphabetic_hotkey(key)?);
            return Ok(KeyboardShortcutInput(input));
        }
        // the modifier keys are using the Up keypress variant because the user has already
        // pressed those keys in order to trigger the feature.
        if let Some(numeric_modifier_key) = get_numeric_modifier_key(key) {
            let input = build_virtual_key_input(InputKeyPress::Up, numeric_modifier_key);
            Ok(KeyboardShortcutInput(input))
        } else {
            Err(anyhow!("Unsupported modifier key: {key}"))
        }
    }
}

/// Given a letter that is a String, get the utf16 encoded
/// decimal version of the letter as long as it meets the
/// [a-z][A-Z] restriction.
///
/// Because we only accept [a-z][A-Z], the decimal u16
/// cast of the letter is safe because the unicode code point
/// of these characters fits in a u16.
fn get_alphabetic_hotkey(letter: &str) -> Result<u16> {
    if letter.len() != 1 {
        error!(
            len = letter.len(),
            "Final keyboard shortcut key should be a single character."
        );
        return Err(anyhow!(
            "Final keyboard shortcut key should be a single character: {letter}"
        ));
    }

    let c = letter.chars().next().expect("letter is size 1");

    // is_ascii_alphabetic() checks for:
    // U+0041 `A` ..= U+005A `Z`, or  U+0061 `a` ..= U+007A `z`
    if !c.is_ascii_alphabetic() {
        error!(letter = %c, "Letter is not ASCII Alphabetic ([a-z][A-Z]).");
        return Err(anyhow!(
            "Letter is not ASCII Alphabetic ([a-z][A-Z]): '{letter}'",
        ));
    }

    let c = c as u16;

    debug!(c, letter, "Got alphabetic hotkey.");

    Ok(c)
}

/// An input key can be either pressed (down), or released (up).
#[derive(Copy, Clone)]
enum InputKeyPress {
    Down,
    Up,
}

/// Before modifying this function, make sure you read the `SendInput()` documentation:
/// <https://learn.microsoft.com/en-in/windows/win32/api/winuser/nf-winuser-sendinput>
/// <https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes>
fn build_input(key_press: InputKeyPress, character: u16, is_virtual: bool) -> INPUT {
    let (w_vk, w_scan, base_flags) = if is_virtual {
        (VIRTUAL_KEY(character), 0, KEYBD_EVENT_FLAGS(0))
    } else {
        (VIRTUAL_KEY::default(), character, KEYEVENTF_UNICODE)
    };
    let dw_flags = match key_press {
        InputKeyPress::Down => base_flags,
        InputKeyPress::Up => base_flags | KEYEVENTF_KEYUP,
    };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: w_vk,
                wScan: w_scan,
                dwFlags: dw_flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// A function for easily building keyboard unicode `INPUT` structs used in `SendInput()`.
fn build_unicode_input(key_press: InputKeyPress, character: u16) -> INPUT {
    build_input(key_press, character, IS_REAL_KEY)
}

/// A function for easily building keyboard virtual-key `INPUT` structs used in `SendInput()`.
fn build_virtual_key_input(key_press: InputKeyPress, character: u16) -> INPUT {
    build_input(key_press, character, IS_VIRTUAL_KEY)
}

fn send_input<I, E>(inputs: &[INPUT]) -> Result<()>
where
    I: InputOperations,
    E: ErrorOperations,
{
    let insert_count = I::send_input(inputs);

    if insert_count == 0 {
        let last_err = E::get_last_error().to_hresult().message();
        error!(GetLastError = %last_err, "SendInput sent 0 inputs. Input was blocked by another thread.");

        return Err(anyhow!("SendInput sent 0 inputs. Input was blocked by another thread. GetLastError: {last_err}"));
    } else if insert_count != u32::try_from(inputs.len()).expect("to convert inputs len to u32") {
        let last_err = E::get_last_error().to_hresult().message();
        error!(sent = %insert_count, expected = inputs.len(), GetLastError = %last_err,
            "SendInput sent does not match expected."
        );
        return Err(anyhow!(
            "SendInput does not match expected. sent: {insert_count}, expected: {}",
            inputs.len()
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    //! For the mocking of the traits that are static methods, we need to use the `serial_test`
    //! crate in order to mock those, since the mock expectations set have to be global in
    //! absence of a `self`. More info: <https://docs.rs/mockall/latest/mockall/#static-methods>

    use serial_test::serial;
    use windows::Win32::Foundation::WIN32_ERROR;

    use super::*;

    #[test]
    fn get_alphabetic_hot_key_succeeds() {
        for c in ('a'..='z').chain('A'..='Z') {
            let letter = c.to_string();
            let converted = get_alphabetic_hotkey(&letter).unwrap();
            assert_eq!(converted, c as u16);
        }
    }

    #[test]
    #[should_panic = "Final keyboard shortcut key should be a single character: foo"]
    fn get_alphabetic_hot_key_fail_not_single_char() {
        let letter = String::from("foo");
        get_alphabetic_hotkey(&letter).unwrap();
    }

    #[test]
    #[should_panic = "Letter is not ASCII Alphabetic ([a-z][A-Z]): '}'"]
    fn get_alphabetic_hot_key_fail_not_alphabetic() {
        let letter = String::from("}");
        get_alphabetic_hotkey(&letter).unwrap();
    }

    #[test]
    #[serial]
    fn send_input_succeeds() {
        let ctxi = MockInputOperations::send_input_context();
        ctxi.checkpoint();
        ctxi.expect().returning(|_| 1);

        send_input::<MockInputOperations, MockErrorOperations>(&[build_unicode_input(
            InputKeyPress::Up,
            0,
        )])
        .unwrap();

        drop(ctxi);
    }

    #[test]
    #[serial]
    fn keyboard_shortcut_conversion_succeeds() {
        let keyboard_shortcut = ["Control", "Alt", "B"];
        let _: Vec<KeyboardShortcutInput> = keyboard_shortcut
            .iter()
            .map(|s| KeyboardShortcutInput::try_from(*s))
            .collect::<anyhow::Result<Vec<_>>>()
            .unwrap();
    }

    #[test]
    #[serial]
    #[should_panic = "Letter is not ASCII Alphabetic ([a-z][A-Z]): '1'"]
    fn keyboard_shortcut_conversion_fails_invalid_key() {
        let keyboard_shortcut = ["Control", "Alt", "1"];
        let _: Vec<KeyboardShortcutInput> = keyboard_shortcut
            .iter()
            .map(|s| KeyboardShortcutInput::try_from(*s))
            .collect::<anyhow::Result<Vec<_>>>()
            .unwrap();
    }

    #[test]
    #[serial]
    fn keyboard_shortcut_conversion_succeeds_with_shift() {
        let keyboard_shortcut = ["Control", "Shift", "ShiftLeft", "ShiftRight", "B"];
        let converted: Vec<KeyboardShortcutInput> = keyboard_shortcut
            .iter()
            .map(|s| KeyboardShortcutInput::try_from(*s))
            .collect::<anyhow::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(converted.len(), 5);
    }

    #[test]
    fn virtual_keys_omit_unicode_flag_and_coalesce_crlf() {
        let utf16: Vec<u16> = "x\ty\r\nz".encode_utf16().collect();
        let mut inputs = Vec::new();
        add_input(&utf16, &mut inputs);
        assert_eq!(inputs.len(), 10);
        unsafe {
            assert_eq!(inputs[2].Anonymous.ki.wVk, VIRTUAL_KEY(0x09));
            assert_eq!(inputs[2].Anonymous.ki.dwFlags, KEYBD_EVENT_FLAGS(0));
            assert_eq!(inputs[3].Anonymous.ki.dwFlags, KEYEVENTF_KEYUP);
            assert_eq!(inputs[6].Anonymous.ki.wVk, VIRTUAL_KEY(0x0D));
            assert_eq!(inputs[6].Anonymous.ki.dwFlags, KEYBD_EVENT_FLAGS(0));
            assert_eq!(inputs[7].Anonymous.ki.dwFlags, KEYEVENTF_KEYUP);
        }
    }

    #[test]
    #[serial]
    #[should_panic(
        expected = "SendInput sent 0 inputs. Input was blocked by another thread. GetLastError:"
    )]
    fn send_input_fails_sent_zero() {
        let ctxi = MockInputOperations::send_input_context();
        ctxi.checkpoint();
        ctxi.expect().returning(|_| 0);

        let ctxge = MockErrorOperations::get_last_error_context();
        ctxge.checkpoint();
        ctxge.expect().returning(|| WIN32_ERROR(1));

        send_input::<MockInputOperations, MockErrorOperations>(&[build_unicode_input(
            InputKeyPress::Up,
            0,
        )])
        .unwrap();

        drop(ctxge);
        drop(ctxi);
    }

    #[test]
    #[serial]
    #[should_panic(expected = "SendInput does not match expected. sent: 2, expected: 1")]
    fn send_input_fails_sent_mismatch() {
        let ctxi = MockInputOperations::send_input_context();
        ctxi.checkpoint();
        ctxi.expect().returning(|_| 2);

        let ctxge = MockErrorOperations::get_last_error_context();
        ctxge.checkpoint();
        ctxge.expect().returning(|| WIN32_ERROR(1));

        send_input::<MockInputOperations, MockErrorOperations>(&[build_unicode_input(
            InputKeyPress::Up,
            0,
        )])
        .unwrap();

        drop(ctxge);
        drop(ctxi);
    }

    #[test]
    fn valid_modifier_keys() {
        assert_eq!(get_numeric_modifier_key("Control").unwrap(), 0x11);
        assert_eq!(get_numeric_modifier_key("Alt").unwrap(), 0x12);
        assert_eq!(get_numeric_modifier_key("Super").unwrap(), 0x5B);
        assert_eq!(get_numeric_modifier_key("Shift").unwrap(), 0x10);
        assert_eq!(get_numeric_modifier_key("ShiftLeft").unwrap(), 0xA0);
        assert_eq!(get_numeric_modifier_key("ShiftRight").unwrap(), 0xA1);
    }

    #[test]
    fn does_not_contain_invalid_modifier_keys() {
        assert!(get_numeric_modifier_key("CapsLock").is_none());
    }
}
