//! VelAgent 桌面壳：Tauri 2 + 本地 AI 控制面。
//!
//! 前端（React，位于 ../frontend）负责画布与元件库；
//! Rust 负责本地控制面、Token、配置与（后续）AI 网关。
//! 传入 --mcp-stdio 时以 MCP 服务器的形式运行（供 Claude Code / Cursor 等 harness 拉起）。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod bridge;
mod config;
mod control;
mod harness;
mod mcp;
mod model;

use std::sync::Arc;
use tauri::Manager;

fn main() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_target(false)
        .init();

    if std::env::args().any(|arg| arg == "--mcp-stdio") {
        std::process::exit(crate::mcp::run_stdio());
    }

    let mut cfg = config::Config::load_or_create();
    let port = control::pick_port(cfg.port);
    if port != cfg.port {
        cfg.port = port;
        let _ = cfg.save();
    }
    let shared = Arc::new(control::Shared::new(cfg, model::Workspace::demo(), port));
    control::spawn(shared.clone(), port);

    tauri::Builder::default()
        .manage(shared)
        .manage(harness::HarnessState::default())
        .manage(std::sync::Arc::new(harness::HarnessWebState::default()))
        .setup(|app| {
            let shared = app.state::<Arc<control::Shared>>();
            shared.set_app(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::get_control_info,
            bridge::sync_workspace,
            bridge::command_result,
            bridge::set_ai_can_write,
            bridge::rotate_token,
            bridge::get_audit_log,
            bridge::sync_catalog,
            bridge::open_url,
            ai::get_ai_config,
            ai::save_ai_config,
            ai::test_ai_connection,
            ai::ai_preview,
            harness::harness_status,
            harness::harness_start,
            harness::harness_prompt,
            harness::harness_stop,
            harness::harness_web_status,
            harness::harness_web_start,
            harness::harness_web_open,
            harness::harness_web_stop,
        ])
        .run(tauri::generate_context!())
        .expect("VelAgent 启动失败");
}
