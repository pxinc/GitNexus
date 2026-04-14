// swift-tools-version:5.3
import PackageDescription

let package = Package(
    name: "TreeSitterArkts",
    products: [
        .library(name: "TreeSitterArkts", targets: ["TreeSitterArkts"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ChimeHQ/SwiftTreeSitter", from: "0.8.0"),
    ],
    targets: [
        .target(
            name: "TreeSitterArkts",
            dependencies: [],
            path: ".",
            sources: [
                "src/parser.c",
                // NOTE: if your language has an external scanner, add it here.
            ],
            resources: [
                .copy("queries")
            ],
            publicHeadersPath: "bindings/swift",
            cSettings: [.headerSearchPath("src")]
        ),
        .testTarget(
            name: "TreeSitterArktsTests",
            dependencies: [
                "SwiftTreeSitter",
                "TreeSitterArkts",
            ],
            path: "bindings/swift/TreeSitterArktsTests"
        )
    ],
    cLanguageStandard: .c11
)
