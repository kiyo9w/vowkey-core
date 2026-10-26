//! Tests for the vowkey CLI version flags

mod common;
use common::vowkey;

/// Helper function to test version output
fn assert_version_output(args: &[&str]) {
    let output = vowkey()
        .args(args)
        .output()
        .expect("Failed to execute vowkey command");

    assert!(output.status.success(), "Command should exit successfully");

    let stdout = String::from_utf8_lossy(&output.stdout);

    assert!(
        stdout.contains("Vowkey CLI"),
        "Output should contain 'Vowkey CLI': {}",
        stdout
    );

    assert!(
        stdout.contains(env!("CARGO_PKG_VERSION")),
        "Output should contain version '{}': {}",
        env!("CARGO_PKG_VERSION"),
        stdout
    );
}

#[test]
fn test_version_flag() {
    assert_version_output(&["--version"]);
}

#[test]
fn test_version_flag_short() {
    assert_version_output(&["-v"]);
}
