// MVP, delete with PM-41067

// Electron / W3C modifier keys
// <https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts#cross-platform-modifiers>
pub(crate) const CONTROL_KEY_STR: &str = "Control";
pub(crate) const CONTROL_LEFT_KEY_STR: &str = "ControlLeft";
pub(crate) const CONTROL_RIGHT_KEY_STR: &str = "ControlRight";
pub(crate) const ALT_KEY_STR: &str = "Alt";
pub(crate) const ALT_LEFT_KEY_STR: &str = "AltLeft";
pub(crate) const ALT_RIGHT_KEY_STR: &str = "AltRight";
pub(crate) const SUPER_KEY_STR: &str = "Super";
pub(crate) const META_KEY_STR: &str = "Meta";
pub(crate) const META_LEFT_KEY_STR: &str = "MetaLeft";
pub(crate) const META_RIGHT_KEY_STR: &str = "MetaRight";
pub(crate) const SHIFT_KEY_STR: &str = "Shift";
pub(crate) const SHIFT_LEFT_KEY_STR: &str = "ShiftLeft";
pub(crate) const SHIFT_RIGHT_KEY_STR: &str = "ShiftRight";

// Win32 virtual-key codes for modifier keys
pub(crate) const CONTROL_KEY: u16 = 0x11;
pub(crate) const CONTROL_LEFT_KEY: u16 = 0xA2;
pub(crate) const CONTROL_RIGHT_KEY: u16 = 0xA3;
pub(crate) const ALT_KEY: u16 = 0x12;
pub(crate) const ALT_LEFT_KEY: u16 = 0xA4;
pub(crate) const ALT_RIGHT_KEY: u16 = 0xA5;
pub(crate) const SUPER_KEY: u16 = 0x5B;
pub(crate) const SUPER_RIGHT_KEY: u16 = 0x5C;
pub(crate) const SHIFT_KEY: u16 = 0x10;
pub(crate) const SHIFT_LEFT_KEY: u16 = 0xA0;
pub(crate) const SHIFT_RIGHT_KEY: u16 = 0xA1;

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
pub(crate) fn get_numeric_modifier_key(modifier: &str) -> Option<u16> {
    for (modifier_str, modifier_num) in MODIFIER_KEYS {
        if modifier_str == modifier {
            return Some(modifier_num);
        }
    }
    None
}

#[cfg(test)]
mod test {
    use super::get_numeric_modifier_key;

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
