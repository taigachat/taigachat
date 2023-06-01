fn main() {
    if cfg!(windows) {
        // These are required by libuv on Windows
        println!("cargo:rustc-link-lib=psapi");
        println!("cargo:rustc-link-lib=user32");
        println!("cargo:rustc-link-lib=advapi32");
        println!("cargo:rustc-link-lib=iphlpapi");
        println!("cargo:rustc-link-lib=userenv");
        println!("cargo:rustc-link-lib=ws2_32");

        // These are required by OpenSSL on Windows
        println!("cargo:rustc-link-lib=ws2_32");
        println!("cargo:rustc-link-lib=gdi32");
        println!("cargo:rustc-link-lib=advapi32");
        println!("cargo:rustc-link-lib=crypt32");
        println!("cargo:rustc-link-lib=user32");
    } else {
        println!("cargo:rustc-link-lib=stdc++");
    }

    // Statically link to libmediasoup-worker
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    //println!("cargo:warning=looking for libmediasoup-worker.a in: {dir}");
    println!("cargo:rustc-link-lib=static=mediasoup-worker");
    println!("cargo:rustc-link-search=native={}", dir);
}
