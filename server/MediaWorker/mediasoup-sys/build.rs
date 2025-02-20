use std::{env, fs};

fn main() {
    let out_dir = env::var("OUT_DIR").unwrap();

    // Compile Rust flatbuffers, directly lifted from mediasoup-sys of the MediaSoup project
    // (see lib.rs for the licensing information)
    let flatbuffers_declarations = planus_translation::translate_files(
        &fs::read_dir("fbs")
            .expect("Failed to read `fbs` directory")
            .filter_map(|maybe_entry| {
                maybe_entry
                    .map(|entry| {
                        let path = entry.path();
                        if path.extension() == Some("fbs".as_ref()) {
                            Some(path)
                        } else {
                            None
                        }
                    })
                    .transpose()
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("Failed to collect flatbuffers files"),
    )
    .expect("Failed to translate flatbuffers files");

    fs::write(
        format!("{out_dir}/fbs.rs"),
        planus_codegen::generate_rust(&flatbuffers_declarations)
            .expect("Failed to generate Rust code from flatbuffers"),
    )
    .expect("Failed to write generated Rust flatbuffers into fbs.rs");

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
