use std::path::Path;

/// WebView2 leftovers this app never needs: map-tile HTTP cache and the components the
/// WebView downloads on its own (DRM, ad filters, speech). Favorites, last city and the
/// shader caches (they make the globe start faster) are kept.
const DISPOSABLE: [&str; 6] = [
    "Default/Cache",
    "Default/blob_storage",
    "WidevineCdm",
    "component_crx_cache",
    "Subresource Filter",
    "Speech Recognition",
];

/// Runs before the WebView starts, so none of these folders is locked.
fn clear_webview_leftovers(identifier: &str) {
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return };
    let profile = Path::new(&local).join(identifier).join("EBWebView");
    for folder in DISPOSABLE {
        let _ = std::fs::remove_dir_all(profile.join(folder));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    clear_webview_leftovers(&context.config().identifier);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .build(context)
        .expect("error while running tauri application")
        .run(|app, event| {
            // Closing the window ends the whole app, WebView and GPU processes included.
            if let tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Destroyed, .. } = event {
                app.exit(0);
            }
        });
}
