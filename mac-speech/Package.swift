// swift-tools-version:6.2
import PackageDescription

// One executable, one dependency. Apple's Speech framework supplies the text
// and word timings; FluidAudio supplies the speaker spans. Nothing else is
// needed, so nothing else is here.
let package = Package(
    name: "mac-speech",
    platforms: [.macOS(.v26)],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", from: "0.12.4")
    ],
    targets: [
        .executableTarget(
            name: "mac-speech",
            dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]
        )
    ]
)
