// swiftlint:disable:this file_name
import VowkeyKit
import SnapshotTesting
import XCTest

// MARK: - VowkeySliderTests

class VowkeySliderTests: VowkeyTestCase {
    // MARK: Tests

    /// Test a snapshot of the slider with a value of 0.
    func disabletest_snapshot_slider_minValue() {
        let subject = VowkeySlider(
            value: .constant(0),
            in: 0 ... 50,
            step: 1,
            onEditingChanged: { _ in },
        )
        assertSnapshots(
            of: subject,
            as: [.defaultPortrait, .defaultPortraitDark],
        )
    }

    /// Test a snapshot of the slider with a value of 25.
    func disabletest_snapshot_slider_midValue() {
        let subject = VowkeySlider(
            value: .constant(25),
            in: 0 ... 50,
            step: 1,
            onEditingChanged: { _ in },
        )
        assertSnapshots(
            of: subject,
            as: [.defaultPortrait, .defaultPortraitDark],
        )
    }

    /// Test a snapshot of the slider with a value of 50.
    func disabletest_snapshot_slider_maxValue() {
        let subject = VowkeySlider(
            value: .constant(50),
            in: 0 ... 50,
            step: 1,
            onEditingChanged: { _ in },
        )
        assertSnapshots(
            of: subject,
            as: [.defaultPortrait, .defaultPortraitDark],
        )
    }
}
