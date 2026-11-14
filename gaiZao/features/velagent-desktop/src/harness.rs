//! 内嵌 DeepSeek Harness 的进程管理（M6）。
//!
//! Rust 只负责拉起一个 Node 桥（harness-bridge/bridge.mjs），桥内部用 DSH 的
//! SDK JSON-RPC 协议驱动一个独立的 dsh 运行时（--profile sdk）。聊天事件通过
//! Tauri event「velagent://harness」转发给前端；前端再 invoke「harness_prompt」发消息。
//!
//! 隔离：DSH_HOME 指向 VelAgent 自己的数据目录（会话记忆与官方实例分离）。

use crate::config::Config;
use crate::control::Shared;
use serde::Serialize;
use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct HarnessProcess {
    child: Child,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct HarnessState {
    inner: Mutex<Option<HarnessProcess>>,
}

#[derive(Serialize)]
pub struct HarnessStatus {
    pub running: bool,
    pub enabled: bool,
    pub repo: String,
    pub bridge: String,
    pub home: String,
    pub model: String,
    pub provider: String,
    pub error: Option<String>,
}

fn app_data_dir() -> PathBuf {
    directories::ProjectDirs::from("ai", "enrui", "VelAgent")
        .map(|d| d.data_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn candidate_repos(config: &Config) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !config.harness.repo_path.trim().is_empty() {
        out.push(PathBuf::from(config.harness.repo_path.trim()));
    }
    if let Ok(env) = std::env::var("VELAGENT_DSH_REPO") {
        out.push(PathBuf::from(env));
    }
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join("deepseek-harness"));
        out.push(cwd.join("..").join("deepseek-harness"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("resources").join("harness"));
            out.push(dir.join("harness"));
            out.push(dir.join("..").join("..").join("..").join("..").join("deepseek-harness"));
        }
    }
    out
}

fn resolve_repo(config: &Config) -> Option<PathBuf> {
    candidate_repos(config)
        .into_iter()
        .find(|path| path.join("apps").join("cli").join("src").join("bin.ts").is_file())
}

fn candidate_bridges(config: &Config) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !config.harness.bridge_path.trim().is_empty() {
        out.push(PathBuf::from(config.harness.bridge_path.trim()));
    }
    if let Ok(env) = std::env::var("VELAGENT_HARNESS_BRIDGE") {
        out.push(PathBuf::from(env));
    }
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join("harness-bridge").join("bridge.mjs"));
        out.push(cwd.join("VelAgent").join("harness-bridge").join("bridge.mjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("resources").join("harness").join("bridge.mjs"));
            out.push(dir.join("harness-bridge").join("bridge.mjs"));
        }
    }
    out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("harness-bridge").join("bridge.mjs"));
    out
}

fn resolve_bridge(config: &Config) -> Option<PathBuf> {
    candidate_bridges(config).into_iter().find(|path| path.is_file())
}

fn yaml_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn write_mcp_patch(home: &Path, exe: &Path, workspace: &Path) -> Result<PathBuf, String> {
    let patch_dir = home.join("patches");
    std::fs::create_dir_all(&patch_dir).map_err(|err| err.to_string())?;
    let patch = patch_dir.join("velagent-mcp.patch.yml");
    let exe_text = exe.to_string_lossy();
    let ws_text = workspace.to_string_lossy();
    let content = format!(
        "# 由 VelAgent 自动生成：把 VelAgent 的画布工具作为 MCP 工具挂给内嵌 harness\n- insert:\n    - id: velagent-canvas-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: velagent\n        transport: stdio\n        command: {}\n        args: ['--mcp-stdio']\n        cwd: {}\n",
        yaml_quote(&exe_text),
        yaml_quote(&ws_text)
    );
    std::fs::write(&patch, content).map_err(|err| err.to_string())?;
    Ok(patch)
}

fn deepseek_key(config: &Config) -> Option<String> {
    let base = config.ai.base_url.to_lowercase();
    if !config.ai.api_key.trim().is_empty() && (base.contains("deepseek") || base.is_empty()) {
        return Some(config.ai.api_key.trim().to_string());
    }
    std::env::var("DEEPSEEK_API_KEY").ok().filter(|key| !key.trim().is_empty())
}

fn emit_process(app: &AppHandle, running: bool) {
    let _ = app.emit("velagent://harness", json!({ "type": "process", "running": running }));
}

fn status_of(state: &HarnessState, config: &Config) -> HarnessStatus {
    let (running, error) = match state.inner.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(process) => match process.child.try_wait() {
                Ok(None) => (true, None),
                Ok(Some(status)) => (false, Some(format!("运行时已退出：{status}"))),
                Err(err) => (false, Some(err.to_string())),
            },
            None => (false, None),
        },
        Err(_) => (false, Some("内部状态锁失败".into())),
    };
    HarnessStatus {
        running,
        enabled: config.harness.enabled,
        repo: resolve_repo(config).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        bridge: resolve_bridge(config).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        home: app_data_dir().join("harness-home").to_string_lossy().to_string(),
        model: config.harness.model.clone(),
        provider: config.harness.provider.clone(),
        error,
    }
}

#[tauri::command]
pub fn harness_status(shared: State<'_, Arc<Shared>>, state: State<'_, HarnessState>) -> HarnessStatus {
    let config = shared.config.lock().unwrap().clone();
    status_of(&state, &config)
}

#[tauri::command]
pub fn harness_start(
    app: AppHandle,
    shared: State<'_, Arc<Shared>>,
    state: State<'_, HarnessState>,
) -> Result<HarnessStatus, String> {
    let config = shared.config.lock().unwrap().clone();
    if !config.harness.enabled {
        return Err("内嵌 harness 未启用".into());
    }
    let repo = resolve_repo(&config).ok_or_else(|| {
        "找不到 deepseek-harness 源码目录。请在配置文件的 harness.repo_path 指定，或设置环境变量 VELAGENT_DSH_REPO".to_string()
    })?;
    let bridge = resolve_bridge(&config).ok_or_else(|| "找不到 harness-bridge/bridge.mjs".to_string())?;
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let home = app_data_dir().join("harness-home");
    let workspace = home.join("workspace");
    std::fs::create_dir_all(&workspace).map_err(|err| err.to_string())?;
    let patch = write_mcp_patch(&home, &exe, &workspace)?;

    let node = if config.harness.node_path.trim().is_empty() {
        "node".to_string()
    } else {
        config.harness.node_path.clone()
    };
    let mut command = Command::new(&node);
    command
        .arg(&bridge)
        .current_dir(&workspace)
        .env("VELAGENT_DSH_REPO", repo.to_string_lossy().to_string())
        .env("DO_NOT_TRACK", "1")
        .env("DSH_HOME", home.to_string_lossy().to_string())
        .env("DSH_AGENTS_HOME", home.join("agents").to_string_lossy().to_string())
        .env("VELAGENT_CWD", workspace.to_string_lossy().to_string())
        .env("VELAGENT_PATCH", patch.to_string_lossy().to_string())
        .env("VELAGENT_PROVIDER", config.harness.provider.clone())
        .env("VELAGENT_MODEL", config.harness.model.clone())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(key) = deepseek_key(&config) {
        command.env("DEEPSEEK_API_KEY", key);
    }

    let mut child = command.spawn().map_err(|err| format!("启动 harness 桥失败：{err}"))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("没有 stdout")?;
    let stderr = child.stderr.take().ok_or("没有 stderr")?;

    {
        let mut guard = state.inner.lock().map_err(|_| "内部状态锁失败".to_string())?;
        if let Some(mut old) = guard.take() {
            let _ = old.child.kill();
        }
        *guard = Some(HarnessProcess { child, stdin });
    }

    let app_out = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let text = line.trim().to_string();
            if text.is_empty() {
                continue;
            }
            let _ = app_out.emit("velagent://harness", json!({ "type": "raw", "line": text }));
        }
    });

    let app_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let text = line.trim().to_string();
            if text.is_empty() {
                continue;
            }
            let _ = app_err.emit("velagent://harness", json!({ "type": "log", "line": text }));
        }
    });

    emit_process(&app, true);
    Ok(status_of(&state, &config))
}

#[tauri::command]
pub fn harness_prompt(state: State<'_, HarnessState>, text: String) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "内部状态锁失败".to_string())?;
    let process = guard.as_mut().ok_or_else(|| "harness 未启动".to_string())?;
    let stdin = process.stdin.as_mut().ok_or_else(|| "harness 标准输入不可用".to_string())?;
    let line = serde_json::to_string(&json!({ "type": "prompt", "text": text })).map_err(|err| err.to_string())?;
    stdin.write_all(line.as_bytes()).map_err(|err| err.to_string())?;
    stdin.write_all(b"\n").map_err(|err| err.to_string())?;
    stdin.flush().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn harness_stop(app: AppHandle, state: State<'_, HarnessState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "内部状态锁失败".to_string())?;
    if let Some(mut process) = guard.take() {
        if let Some(stdin) = process.stdin.as_mut() {
            let _ = stdin.write_all(b"{\"type\":\"stop\"}\n");
            let _ = stdin.flush();
        }
        let _ = process.child.kill();
    }
    emit_process(&app, false);
    Ok(())
}

// ── DSH Web UI（保留官方界面：插件市场 / 设置 / 完整对话）────────────────────
//
// 用户要求保留 DeepSeek 自己的前端，否则无法安装插件。这里把官方 web profile
// 作为子进程跑在 2021 端口，然后在 VelAgent 里用独立窗口打开它。

use std::net::SocketAddr;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const HARNESS_WEB_PORT: u16 = 2021;

#[derive(Default)]
pub struct HarnessWebState {
    inner: Mutex<Option<Child>>,
    /// 官方 Web UI 的带 token URL（首次启动后从 stdout 解析）
    url: Mutex<String>,
}

#[derive(Serialize)]
pub struct HarnessWebStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
    pub error: Option<String>,
}

fn web_url() -> String {
    format!("http://127.0.0.1:{HARNESS_WEB_PORT}/")
}

fn port_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(350),
    )
    .is_ok()
}

fn web_status_of(state: &HarnessWebState) -> HarnessWebStatus {
    let (running, error) = match state.inner.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => (port_open(HARNESS_WEB_PORT), None),
                Ok(Some(status)) => (false, Some(format!("Harness Web 已退出：{status}"))),
                Err(err) => (false, Some(err.to_string())),
            },
            None => (false, None),
        },
        Err(_) => (false, Some("内部状态锁失败".into())),
    };
    let url = state.url.lock().map(|value| value.clone()).unwrap_or_default();
    HarnessWebStatus {
        running,
        port: HARNESS_WEB_PORT,
        url: if url.is_empty() { web_url() } else { url },
        error,
    }
}

#[tauri::command]
pub fn harness_web_status(state: State<'_, Arc<HarnessWebState>>) -> HarnessWebStatus {
    web_status_of(&state)
}

#[tauri::command]
pub async fn harness_web_start(
    app: AppHandle,
    shared: State<'_, Arc<Shared>>,
    state: State<'_, Arc<HarnessWebState>>,
) -> Result<HarnessWebStatus, String> {
    let config = shared.config.lock().unwrap().clone();

    if web_status_of(&state).running {
        return Ok(web_status_of(&state));
    }

    let repo = resolve_repo(&config).ok_or_else(|| {
        "找不到 deepseek-harness 源码目录。请在配置文件的 harness.repo_path 指定，或设置 VELAGENT_DSH_REPO".to_string()
    })?;
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let home = app_data_dir().join("harness-home");
    let workspace = home.join("workspace");
    std::fs::create_dir_all(&workspace).map_err(|err| err.to_string())?;
    let patch = write_mcp_patch(&home, &exe, &workspace)?;
    let loader = repo.join("node_modules").join("tsx").join("dist").join("loader.mjs");
    if !loader.is_file() {
        return Err("缺少 tsx：请先在 deepseek-harness 目录执行 pnpm install".into());
    }
    let loader_url = format!("file:///{}", loader.to_string_lossy().replace('\\', "/"));

    let node = if config.harness.node_path.trim().is_empty() {
        "node".to_string()
    } else {
        config.harness.node_path.clone()
    };
    let mut command = Command::new(&node);
    command
        .arg("--import")
        .arg(&loader_url)
        .arg("apps/cli/src/bin.ts")
        .arg("--profile")
        .arg("web")
        .arg("--patch")
        .arg(patch.to_string_lossy().to_string())
        .arg("--port")
        .arg(HARNESS_WEB_PORT.to_string())
        .arg("--no-open")
        .current_dir(&repo)
        .env("DSH_HOME", home.to_string_lossy().to_string())
        .env("DSH_AGENTS_HOME", home.join("agents").to_string_lossy().to_string())
        .env(
            "TSX_TSCONFIG_PATH",
            repo.join("apps").join("cli").join("tsconfig.json").to_string_lossy().to_string(),
        )
        .env("DO_NOT_TRACK", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(key) = deepseek_key(&config) {
        command.env("DEEPSEEK_API_KEY", key);
    }

    let mut child = command.spawn().map_err(|err| format!("启动 Harness Web 失败：{err}"))?;
    let stdout = child.stdout.take().ok_or("没有 stdout")?;
    let stderr = child.stderr.take().ok_or("没有 stderr")?;

    {
        let mut guard = state.inner.lock().map_err(|_| "内部状态锁失败".to_string())?;
        if let Some(mut old) = guard.take() {
            let _ = old.kill();
        }
        *guard = Some(child);
    }

    let app_out = app.clone();
    let state_for_url = state.inner().clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let text = line.trim().to_string();
            if let Some(index) = text.find("http://127.0.0.1:") {
                let url = text[index..].trim().to_string();
                if let Ok(mut guard) = state_for_url.url.lock() {
                    *guard = url.clone();
                }
                let _ = app_out.emit("velagent://harness-web", json!({ "type": "url", "url": url }));
            }
            let _ = app_out.emit("velagent://harness-web", json!({ "type": "log", "line": text }));
        }
    });
    let app_err = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_err.emit("velagent://harness-web", json!({ "type": "log", "line": line }));
        }
    });

    for _ in 0..60 {
        if port_open(HARNESS_WEB_PORT) {
            // 等待 stdout 打印的带 token URL（最多 10 秒）
            for _ in 0..20 {
                let url = state.url.lock().map(|value| value.clone()).unwrap_or_default();
                if !url.is_empty() {
                    return Ok(web_status_of(&state));
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            return Ok(web_status_of(&state));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("Harness Web 启动超时：请确认已执行 pnpm build:artifacts（官方前端资源），并查看应用日志".into())
}

/// 在独立窗口打开官方 Harness 界面（插件安装 / 设置 / 完整对话）
#[tauri::command]
pub fn harness_web_open(app: AppHandle, state: State<'_, Arc<HarnessWebState>>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("harness") {
        let _ = window.set_focus();
        return Ok(());
    }
    let stored = state.url.lock().map(|value| value.clone()).unwrap_or_default();
    let target = if stored.is_empty() { web_url() } else { stored };
    let url: tauri::Url = target.parse().map_err(|err| format!("URL 解析失败：{err}"))?;
    WebviewWindowBuilder::new(&app, "harness", WebviewUrl::External(url))
        .title("DeepSeek Harness · 插件与设置")
        .inner_size(1320.0, 900.0)
        .min_inner_size(900.0, 640.0)
        .build()
        .map_err(|err| format!("打开 Harness 窗口失败：{err}"))?;
    Ok(())
}

#[tauri::command]
pub fn harness_web_stop(app: AppHandle, state: State<'_, Arc<HarnessWebState>>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "内部状态锁失败".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
    if let Some(window) = app.get_webview_window("harness") {
        let _ = window.close();
    }
    Ok(())
}
