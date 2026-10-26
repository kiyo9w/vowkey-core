use vowkey_error::vowkey_error;

/// Full errors do not support changing the name of the error in the generated JS
#[vowkey_error(full, export_as = "SomeOtherError")]
struct SomeError;

fn main() {}
