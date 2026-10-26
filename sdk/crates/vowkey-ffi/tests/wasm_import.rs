#![allow(missing_docs)]

use vowkey_ffi::wasm_import;

// --- Test: a block of imports compiles and its types are usable from Rust ---

#[wasm_import]
extern "C" {
    #[wasm_bindgen(js_name = Date)]
    pub type JsDate;

    #[wasm_bindgen(method, js_name = getTime)]
    pub fn get_time(this: &JsDate) -> f64;
}

#[allow(dead_code)]
fn time_of(date: &JsDate) -> f64 {
    date.get_time()
}

#[cfg(feature = "wasm")]
#[test]
fn an_imported_type_implements_the_wire_traits() {
    fn crosses_as_itself<T: vowkey_ffi::FromWasm<Wire = T> + vowkey_ffi::ToWasm<Wire = T>>() {}
    crosses_as_itself::<JsDate>();
}
