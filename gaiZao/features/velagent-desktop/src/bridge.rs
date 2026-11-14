//! 前端（WebView）与 Rust 之间的桥：
//! - 前端把画布状态推给 Rust（供 AI 读取）
//! - Rust 把 AI 的写命令通过 Tauri event 下发，前端执行后回传结果与最新状态

use crate::control::{CommandOutcome, ControlInfo, Shared};
use crate::model::Workspace;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_control_info(shared: State<'_, Arc<Shared>>) -> ControlInfo {
    shared.control_info()
}

#[tauri::command]
pub fn sync_workspace(shared: State<'_, Arc<Shared>>, workspace: Workspace) -> u64 {
    let mut guard = shared.workspace.lock().unwrap();
    let revision = guard.revision.max(workspace.revision) + 1;
    let mut next = workspace;
    next.revision = revision;
    *guard = next;
    revision
}

#[tauri::command]
pub fn command_result(
    shared: State<'_, Arc<Shared>>,
    id: u64,
    ok: bool,
    error: Option<String>,
    workspace: Option<Workspace>,
    result: Option<serde_json::Value>,
) -> bool {
    shared.complete(id, CommandOutcome { ok, error, workspace, result })
}

#[tauri::command]
pub fn set_ai_can_write(shared: State<'_, Arc<Shared>>, enabled: bool) -> bool {
    if let Ok(mut cfg) = shared.config.lock() {
        cfg.ai_can_write = enabled;
        let _ = cfg.save();
        return enabled;
    }
    false
}

#[tauri::command]
pub fn rotate_token(shared: State<'_, Arc<Shared>>) -> String {
    if let Ok(mut cfg) = shared.config.lock() {
        cfg.rotate_token();
        return cfg.token.clone();
    }
    String::new()
}

#[tauri::command]
pub fn get_audit_log(shared: State<'_, Arc<Shared>>) -> Vec<serde_json::Value> {
    shared.history()
}

/// 前端上报真实目录（板卡/元件），让控制面返回的 catalog 与实际界面一致
#[tauri::command]
pub fn sync_catalog(shared: State<'_, Arc<Shared>>, catalog: serde_json::Value) -> bool {
    if let Ok(mut guard) = shared.catalog.lock() {
        *guard = catalog;
        return true;
    }
    false
}

/// 用系统默认浏览器打开外部链接（Tauri WebView 里直接点 <a target="_blank"> 不会打开浏览器）
#[tauri::command]
pub fn open_url(url: String) -> bool {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        return std::process::Command::new("explorer")
            .arg(&url)
            .spawn()
            .map(|_| true)
            .unwrap_or(false);
    }
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("open").arg(&url).spawn().is_ok();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return std::process::Command::new("xdg-open").arg(&url).spawn().is_ok();
    }
    #[allow(unreachable_code)]
    false
}
