#[cfg(target_os = "windows")]
fn main() {
    println!("cargo:rerun-if-changed=assets/phantomplay.ico");
    println!("cargo:rerun-if-changed=Cargo.toml");

    let mut resource = winres::WindowsResource::new();
    resource.set_icon("assets/phantomplay.ico");
    resource
        .compile()
        .expect("failed to embed PhantomPlay Windows identity resources");
}

#[cfg(not(target_os = "windows"))]
fn main() {}
