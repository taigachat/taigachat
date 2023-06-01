fn main() -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let icon_path: std::path::PathBuf = "../genicons/icon.ico".into();
        let mut res = winres::WindowsResource::new();
        if icon_path.exists() {
            res.set_icon(icon_path.to_str().unwrap());
        }
        res.set("InternalName", "app-launcher.exe");
        // TODO: This could be fetched? .set_version_info(winres::VersionInfo::PRODUCTVERSION, 0x0001000000000000);
        res.compile()?;
    }
    Ok(())
}
