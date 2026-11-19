//! 本地控制面（AI Control Plane）。
//!
//! - 只监听 127.0.0.1；/health 与 /llms.txt 公开，其余需要 Bearer Token；
//! - 读接口直接返回 Rust 侧维护的画布镜像；
//! - 写接口把命令通过 Tauri event 发给前端执行，等前端回传结果与最新状态；
//! - GET /api/v1/events 提供 SSE，AI/用户都能实时看到对方在改什么。

use crate::config::Config;
use crate::model::{self, Workspace};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, oneshot};

/// 前端执行命令后的回执
pub struct CommandOutcome {
    pub ok: bool,
    pub error: Option<String>,
    pub workspace: Option<Workspace>,
    pub result: Option<Value>,
}

#[derive(Serialize)]
pub struct ControlInfo {
    pub port: u16,
    pub token: String,
    pub ai_can_write: bool,
    pub version: String,
}

pub struct Shared {
    pub config: Mutex<Config>,
    pub workspace: Mutex<Workspace>,
    pub port: u16,
    app: Mutex<Option<AppHandle>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<CommandOutcome>>>,
    next_id: AtomicU64,
    events: broadcast::Sender<Value>,
    audit: Mutex<Vec<Value>>,
    /// 前端上报的真实目录（板卡/元件），供 AI 查询；空时回退内置静态表
    pub catalog: Mutex<Value>,
}

impl Shared {
    pub fn new(config: Config, workspace: Workspace, port: u16) -> Self {
        let (events, _) = broadcast::channel(128);
        Self {
            config: Mutex::new(config),
            workspace: Mutex::new(workspace),
            port,
            app: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            events,
            audit: Mutex::new(Vec::new()),
            catalog: Mutex::new(Value::Null),
        }
    }

    pub fn set_app(&self, app: AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }

    pub fn control_info(&self) -> ControlInfo {
        let cfg = self.config.lock().unwrap();
        ControlInfo {
            port: self.port,
            token: cfg.token.clone(),
            ai_can_write: cfg.ai_can_write,
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }

    /// 前端回执：唤醒等待中的 HTTP 请求
    pub fn complete(&self, id: u64, outcome: CommandOutcome) -> bool {
        let tx = self.pending.lock().unwrap().remove(&id);
        match tx {
            Some(tx) => tx.send(outcome).is_ok(),
            None => false,
        }
    }

    pub fn history(&self) -> Vec<Value> {
        self.audit.lock().unwrap().clone()
    }
}

fn api_err(status: StatusCode, code: &str, message: impl Into<String>, hint: impl Into<String>) -> (StatusCode, Json<Value>) {
    let hint = hint.into();
    let mut err = json!({ "code": code, "message": message.into() });
    if !hint.is_empty() {
        err["hint"] = json!(hint);
    }
    (status, Json(json!({ "error": err })))
}

fn unauthorized() -> (StatusCode, Json<Value>) {
    api_err(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "缺少或错误的 Authorization: Bearer <token>", "令牌在应用「AI 控制台」里")
}

fn read_only() -> (StatusCode, Json<Value>) {
    api_err(StatusCode::FORBIDDEN, "READ_ONLY", "AI 修改画布未开启", "在应用「AI 控制台」勾选“允许 AI 修改画布”")
}

fn authorized(shared: &Shared, headers: &HeaderMap) -> bool {
    let Ok(cfg) = shared.config.lock() else { return false };
    let Some(value) = headers.get(axum::http::header::AUTHORIZATION) else { return false };
    let Ok(text) = value.to_str() else { return false };
    text.strip_prefix("Bearer ").map(|t| t == cfg.token).unwrap_or(false)
}

fn can_write(shared: &Shared) -> bool {
    shared.config.lock().map(|c| c.ai_can_write).unwrap_or(false)
}

/// 把一个命令派发给前端，等待回执
pub async fn dispatch(shared: &Arc<Shared>, command: Value) -> Result<Value, (StatusCode, Json<Value>)> {
    let app = shared.app.lock().unwrap().clone();
    let Some(app) = app else {
        return Err(api_err(StatusCode::SERVICE_UNAVAILABLE, "BRIDGE_NOT_READY", "桌面桥未就绪", "应用窗口还没加载完成，请稍后重试"));
    };
    let id = shared.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    shared.pending.lock().unwrap().insert(id, tx);
    let envelope = json!({ "id": id, "command": command });
    if let Err(err) = app.emit("velagent://command", envelope) {
        shared.pending.lock().unwrap().remove(&id);
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, "EMIT_FAILED", format!("无法向前端派发命令: {err}"), ""));
    }

    match tokio::time::timeout(Duration::from_secs(10), rx).await {
        Ok(Ok(outcome)) => {
            if !outcome.ok {
                let message = outcome.error.unwrap_or_else(|| "命令执行失败".into());
                return Err(api_err(StatusCode::UNPROCESSABLE_ENTITY, "COMMAND_FAILED", message, "可先 GET /api/v1/state 核对当前画布"));
            }
            if let Some(ws) = outcome.workspace {
                let mut guard = shared.workspace.lock().unwrap();
                let next_revision = guard.revision.max(ws.revision) + 1;
                let mut next = ws;
                next.revision = next_revision;
                *guard = next;
            }
            let snapshot = shared.workspace.lock().unwrap().clone();
            let event = json!({ "type": "state.changed", "revision": snapshot.revision });
            let _ = shared.events.send(event.clone());
            shared.audit.lock().unwrap().push(json!({
                "at": unix_ms(),
                "event": event,
            }));
            if shared.audit.lock().unwrap().len() > 500 {
                shared.audit.lock().unwrap().drain(0..100);
            }
            Ok(json!({ "ok": true, "revision": snapshot.revision, "result": outcome.result }))
        }
        _ => {
            shared.pending.lock().unwrap().remove(&id);
            Err(api_err(StatusCode::GATEWAY_TIMEOUT, "BRIDGE_TIMEOUT", "前端未在 10 秒内响应", "确认应用窗口未关闭，且画布已加载"))
        }
    }
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ── 只读端点 ────────────────────────────────────────────────────────────────

async fn health(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    Json(json!({
        "ok": true,
        "name": "VelAgent",
        "version": env!("CARGO_PKG_VERSION"),
        "port": shared.port,
        "api": "v1",
    }))
}

async fn llms_txt(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    let port = shared.port;
    let body = format!(
        "# VelAgent 本地控制面指南\n\n\
你（AI harness）可以读写用户的画布，帮助他学习接线。\n\n\
## 连接\n\
- 地址：http://127.0.0.1:{port}\n\
- 认证：所有 /api/v1/* 请求带 Authorization: Bearer <token>（token 在应用「AI 控制台」可见）\n\
- 机器可读：/api/v1/openapi.json\n\n\
## 快速开始\n\
1. GET /api/v1/state —— 先看用户画了什么、当前 revision；\n\
2. GET /api/v1/catalog/boards 与 /api/v1/catalog/components —— 确认可用 id；\n\
3. POST /api/v1/batch —— 一次提交“放板子 + 放元件 + 连线”，原子生效、可一次撤销；\n\
4. POST /api/v1/validate —— 校验接线，有错按 hint 修复；\n\
5. 用中文向用户解释接线与原因。\n\n\
## 端点\n\
只读：GET /api/v1/state · /catalog/boards · /catalog/components · /boards/{{id}}/pins · /events\n\
写：POST /boards · PATCH /boards/{{id}} · DELETE /boards/{{id}}\n\
    POST /components · PATCH /components/{{id}} · DELETE /components/{{id}}\n\
    POST /wires · DELETE /wires/{{id}} · POST /batch · POST /validate\n\
    POST /highlight · POST /view · POST /undo · POST /redo\n\n\
## 引脚规则\n\
- 板卡引脚用真实名称：RP2040/Pico 为 GP0..GP29、3V3、GND；Arduino Uno 为 D0..D13、A0..A5、5V、3V3、GND.1/GND.2；\n\
- 元件引脚：LED 为 A(长脚/正极)/C(短脚/负极)；电阻为 1/2；按钮为 1.l/2.l；蜂鸣器为 1/2；\n\
- 面包板孔：a1..j30（字母行 a-j，数字列 1-30），同一竖排（a-e 或 f-j）互通，中间沟槽隔开；\n\
- 连线只表达“谁的哪个引脚”，不要编造坐标；\n\
- 每次改完必须调用 /validate，并把错误翻译成人话告诉用户。\n\n\
## 教学场景建议\n\
- 先放板卡与面包板，再放元件，最后连线；\n\
- 每步解释“为什么”：GPIO → 限流电阻 → LED 长脚 → LED 短脚 → GND；\n\
- 常见错误见 /validate 的错误码说明。\n"
    );
    ([(axum::http::header::CONTENT_TYPE, "text/markdown; charset=utf-8")], body)
}

async fn openapi(State(shared): State<Arc<Shared>>) -> impl IntoResponse {
    let port = shared.port;
    Json(json!({
        "openapi": "3.1.0",
        "info": { "title": "VelAgent local control plane", "version": env!("CARGO_PKG_VERSION") },
        "servers": [{ "url": format!("http://127.0.0.1:{port}") }],
        "components": { "securitySchemes": { "bearer": { "type": "http", "scheme": "bearer" } } },
        "paths": {
            "/health": { "get": { "summary": "health check", "security": [] } },
            "/api/v1/state": { "get": { "summary": "current workspace", "security": [{ "bearer": [] }] } },
            "/api/v1/catalog/boards": { "get": { "summary": "board catalog", "security": [{ "bearer": [] }] } },
            "/api/v1/catalog/components": { "get": { "summary": "component catalog", "security": [{ "bearer": [] }] } },
            "/api/v1/boards": { "post": { "summary": "place a board", "security": [{ "bearer": [] }] } },
            "/api/v1/components": { "post": { "summary": "place a component", "security": [{ "bearer": [] }] } },
            "/api/v1/wires": { "post": { "summary": "connect two pins", "security": [{ "bearer": [] }] } },
            "/api/v1/batch": { "post": { "summary": "atomic batch", "security": [{ "bearer": [] }] } },
            "/api/v1/validate": { "post": { "summary": "wiring validation", "security": [{ "bearer": [] }] } },
            "/api/v1/undo": { "post": { "summary": "undo", "security": [{ "bearer": [] }] } },
            "/api/v1/events": { "get": { "summary": "SSE stream", "security": [{ "bearer": [] }] } }
        }
    }))
}

async fn get_state(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    let ws = shared.workspace.lock().map(|w| w.clone()).unwrap_or_default();
    (StatusCode::OK, Json(serde_json::to_value(ws).unwrap_or_else(|_| json!({}))))
}

fn catalog_items(shared: &Shared, key: &str) -> Value {
    if let Ok(catalog) = shared.catalog.lock() {
        if let Some(items) = catalog.get(key).and_then(|v| v.as_array()) {
            if !items.is_empty() {
                return Value::Array(items.clone());
            }
        }
    }
    match key {
        "boards" => serde_json::to_value(model::board_catalog()).unwrap_or(Value::Null),
        _ => serde_json::to_value(model::component_catalog()).unwrap_or(Value::Null),
    }
}

async fn catalog_boards(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    (StatusCode::OK, Json(json!({ "items": catalog_items(&shared, "boards") })))
}

async fn catalog_components(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    (StatusCode::OK, Json(json!({ "items": catalog_items(&shared, "components") })))
}

async fn audit_log(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    (StatusCode::OK, Json(json!({ "items": shared.history() })))
}

/// SSE：画布变更事件流
async fn events(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> Response {
    if !authorized(&shared, &headers) {
        return unauthorized().into_response();
    }
    let rx = shared.events.subscribe();
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(value) => {
                    let event = Event::default().event("state.changed").data(value.to_string());
                    return Some((Ok::<Event, Infallible>(event), rx));
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).into_response()
}

// ── 写端点 ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PlaceBoardBody {
    kind: String,
    #[serde(default)]
    x: Option<f32>,
    #[serde(default)]
    y: Option<f32>,
    #[serde(default)]
    position: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

async fn place_board(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(body): Json<PlaceBoardBody>,
) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "place_board", "kind": body.kind, "x": body.x, "y": body.y, "position": body.position, "name": body.name });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn patch_board(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(patch): Json<Value>,
) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "update_board", "id": id, "patch": patch });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn delete_board(State(shared): State<Arc<Shared>>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "remove_board", "id": id });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

#[derive(Deserialize)]
struct PlaceComponentBody {
    #[serde(alias = "metadataId")]
    metadata_id: String,
    #[serde(default)]
    x: Option<f32>,
    #[serde(default)]
    y: Option<f32>,
    #[serde(default)]
    seat_on: Option<String>,
    #[serde(default)]
    rotation: Option<f32>,
    #[serde(default)]
    properties: Option<Value>,
}

async fn place_component(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(body): Json<PlaceComponentBody>,
) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({
        "op": "place_component",
        "metadata_id": body.metadata_id,
        "x": body.x,
        "y": body.y,
        "seat_on": body.seat_on,
        "rotation": body.rotation,
        "properties": body.properties,
    });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn patch_component(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(patch): Json<Value>,
) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "update_component", "id": id, "patch": patch });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn delete_component(State(shared): State<Arc<Shared>>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "remove_component", "id": id });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

#[derive(Deserialize, Serialize)]
struct PinRefBody {
    #[serde(alias = "boardId", alias = "componentId")]
    owner_id: String,
    pin: String,
}

#[derive(Deserialize)]
struct ConnectBody {
    from: PinRefBody,
    to: PinRefBody,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    signal: Option<String>,
}

async fn connect(State(shared): State<Arc<Shared>>, headers: HeaderMap, Json(body): Json<ConnectBody>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "connect", "from": body.from, "to": body.to, "color": body.color, "signal": body.signal });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn delete_wire(State(shared): State<Arc<Shared>>, headers: HeaderMap, Path(id): Path<String>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "remove_wire", "id": id });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

#[derive(Deserialize)]
struct BatchBody {
    commands: Vec<Value>,
    #[serde(default)]
    atomic: Option<bool>,
}

async fn batch(State(shared): State<Arc<Shared>>, headers: HeaderMap, Json(body): Json<BatchBody>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "batch", "commands": body.commands, "atomic": body.atomic.unwrap_or(true) });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn validate(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    let command = json!({ "op": "validate" });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

#[derive(Deserialize)]
struct HighlightBody {
    #[serde(default)]
    owner_id: Option<String>,
    #[serde(default)]
    pins: Vec<String>,
    #[serde(default)]
    message: Option<String>,
}

async fn highlight(State(shared): State<Arc<Shared>>, headers: HeaderMap, Json(body): Json<HighlightBody>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    let command = json!({ "op": "highlight", "owner_id": body.owner_id, "pins": body.pins, "message": body.message });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn view(State(shared): State<Arc<Shared>>, headers: HeaderMap, Json(body): Json<Value>) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    let command = json!({ "op": "view", "target": body });
    match dispatch(&shared, command).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn undo(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    match dispatch(&shared, json!({ "op": "undo" })).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

async fn redo(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    if !can_write(&shared) {
        return read_only();
    }
    match dispatch(&shared, json!({ "op": "redo" })).await {
        Ok(value) => (StatusCode::OK, Json(value)),
        Err(err) => err,
    }
}

/// AI 运行预测（供 harness 调用；等价于界面上的「AI 运行」）
async fn run_preview(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    let request: Result<crate::ai::PreviewRequest, _> = serde_json::from_value(body);
    let Ok(request) = request else {
        return api_err(StatusCode::BAD_REQUEST, "BAD_REQUEST", "请求体需要 code / language / circuit", "示例：{\"code\":\"void loop(){}\"}");
    };
    let shared_for_task = shared.clone();
    match tokio::task::spawn_blocking(move || crate::ai::preview_core(&shared_for_task, request)).await {
        Ok(Ok(value)) => (StatusCode::OK, Json(value)),
        Ok(Err(err)) => api_err(
            StatusCode::BAD_GATEWAY,
            "AI_PREVIEW_FAILED",
            err,
            "检查 AI 设置（服务商 / Base URL / 模型 / Key），或换成本地 Ollama",
        ),
        Err(err) => api_err(StatusCode::INTERNAL_SERVER_ERROR, "TASK_FAILED", format!("运行预测任务失败: {err}"), ""),
    }
}

async fn rotate_token(State(shared): State<Arc<Shared>>, headers: HeaderMap) -> impl IntoResponse {
    if !authorized(&shared, &headers) {
        return unauthorized();
    }
    let mut cfg = shared.config.lock().unwrap();
    cfg.rotate_token();
    let token = cfg.token.clone();
    (StatusCode::OK, Json(json!({ "ok": true, "token": token })))
}

// ── 路由与启动 ──────────────────────────────────────────────────────────────

pub fn router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/llms.txt", get(llms_txt))
        .route("/api/v1/openapi.json", get(openapi))
        .route("/api/v1/state", get(get_state))
        .route("/api/v1/catalog/boards", get(catalog_boards))
        .route("/api/v1/catalog/components", get(catalog_components))
        .route("/api/v1/events", get(events))
        .route("/api/v1/audit", get(audit_log))
        .route("/api/v1/token/rotate", post(rotate_token))
        .route("/api/v1/boards", post(place_board))
        .route("/api/v1/boards/{id}", patch(patch_board).delete(delete_board))
        .route("/api/v1/components", post(place_component))
        .route("/api/v1/components/{id}", patch(patch_component).delete(delete_component))
        .route("/api/v1/wires", post(connect))
        .route("/api/v1/wires/{id}", delete(delete_wire))
        .route("/api/v1/batch", post(batch))
        .route("/api/v1/validate", post(validate))
        .route("/api/v1/highlight", post(highlight))
        .route("/api/v1/view", post(view))
        .route("/api/v1/undo", post(undo))
        .route("/api/v1/redo", post(redo))
        .route("/api/v1/run/preview", post(run_preview))
        .with_state(shared)
}

pub fn pick_port(preferred: u16) -> u16 {
    for offset in 0..20u16 {
        let port = preferred.saturating_add(offset);
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    preferred
}

pub fn spawn(shared: Arc<Shared>, port: u16) {
    std::thread::Builder::new()
        .name("velagent-control-api".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
                Ok(rt) => rt,
                Err(err) => {
                    tracing::error!(?err, "无法创建 tokio runtime");
                    return;
                }
            };
            rt.block_on(async move {
                let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
                match tokio::net::TcpListener::bind(addr).await {
                    Ok(listener) => {
                        tracing::info!(%addr, "AI 控制面已启动");
                        if let Err(err) = axum::serve(listener, router(shared)).await {
                            tracing::error!(?err, "控制面异常退出");
                        }
                    }
                    Err(err) => tracing::error!(?err, %addr, "控制面端口绑定失败"),
                }
            });
        })
        .ok();
}

