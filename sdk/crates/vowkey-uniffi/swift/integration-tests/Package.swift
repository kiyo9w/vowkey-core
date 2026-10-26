// swift-tools-version: 5.9
// Integration tests for the Swift bindings of the Vowkey SDK.
//
// This package depends on the parent `VowkeySdk` package via a local
// path dependency. The parent package brings in the prebuilt
// `VowkeyFFI.xcframework` (iOS only), so tests must target an iOS
// destination — typically run via `xcodebuild test -destination
// 'platform=iOS Simulator,...'`.

import PackageDescription

let package = Package(
    name: "IntegrationTests",
    platforms: [
        .iOS(.v13),
    ],
    dependencies: [
        .package(name: "VowkeySdk", path: "..")
    ],
    targets: [
        .testTarget(
            name: "IntegrationTests",
            dependencies: [
                .product(name: "VowkeySdk", package: "VowkeySdk")
            ]
        )
    ]
)
