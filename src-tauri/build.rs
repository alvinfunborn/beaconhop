use std::{env, path::PathBuf, process::Command};
fn main() {
    println!("cargo:rerun-if-changed=native/BeaconBridge.swift");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var("OUT_DIR").unwrap());
        let arch = if env::var("CARGO_CFG_TARGET_ARCH").unwrap() == "aarch64" {
            "arm64"
        } else {
            "x86_64"
        };
        let status = Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-emit-library",
                "-static",
                "-module-name",
                "BeaconBridge",
                "-target",
                &format!("{arch}-apple-macosx14.0"),
                "native/BeaconBridge.swift",
                "-o",
            ])
            .arg(out.join("libBeaconBridge.a"))
            .status()
            .expect("Xcode Swift compiler is required");
        assert!(status.success(), "Swift bridge compilation failed");
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=BeaconBridge");
        let swift = Command::new("xcrun")
            .args(["--find", "swiftc"])
            .output()
            .unwrap();
        let compiler = PathBuf::from(String::from_utf8(swift.stdout).unwrap().trim());
        println!(
            "cargo:rustc-link-search=native={}",
            compiler
                .parent()
                .unwrap()
                .join("../lib/swift/macosx")
                .display()
        );
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        for name in [
            "swiftCore",
            "swiftFoundation",
            "swiftAppKit",
            "swiftCoreGraphics",
            "swiftDarwin",
            "swiftDispatch",
            "swiftObjectiveC",
            "swift_Concurrency",
        ] {
            println!("cargo:rustc-link-lib=dylib={name}");
        }
        for name in [
            "AppKit",
            "Foundation",
            "ApplicationServices",
            "CoreGraphics",
            "ScreenCaptureKit",
        ] {
            println!("cargo:rustc-link-lib=framework={name}");
        }
    }
    tauri_build::build()
}
