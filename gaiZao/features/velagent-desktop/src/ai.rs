//! AI 网关：用户自带 Key（OpenAI 兼容接口），把「电路 + 代码」发给模型，
//! 要求它返回严格 JSON 的「行为剧本」（时间轴），前端播放成动画。
//!
//! 首版 Key 存在本地配置文件（%APPDATA%/Enrui/VelAgent），M4 再迁移到系统凭据管理器。

use crate::control::Shared;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiSettingsView {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub can_write: bool,
}

#[derive(Debug, Deserialize)]
pub struct SaveAiBody {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PreviewRequest {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub circuit: Value,
    #[serde(default)]
    pub board_kind: Option<String>,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .build()
        .into()
}

fn trim_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

fn chat_completion(shared: &Shared, system: &str, user: &str) -> Result<String, String> {
    let (base, model, key) = {
        let cfg = shared.config.lock().map_err(|_| "配置锁失败".to_string())?;
        (trim_base(&cfg.ai.base_url), cfg.ai.model.clone(), cfg.ai.api_key.clone())
    };
    if base.is_empty() || model.is_empty() {
        return Err("AI_NOT_CONFIGURED".into());
    }
    if key.is_empty() && !base.contains("localhost") && !base.contains("127.0.0.1") {
        return Err("API_KEY_MISSING".into());
    }
    let url = format!("{base}/chat/completions");
    let body = json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });
    let text = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    let mut request = agent().post(&url).header("Content-Type", "application/json");
    if !key.is_empty() {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }
    let response = request.send(text).map_err(|e| format!("AI_REQUEST_FAILED: {e}"))?;
    let mut response = response;
    let raw = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("AI_READ_FAILED: {e}"))?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("AI_BAD_JSON: {e}"))?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .or_else(|| parsed["message"]["content"].as_str())
        .ok_or_else(|| format!("AI_NO_CONTENT: {}", truncate(&raw, 300)))?;
    Ok(content.to_string())
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect::<String>() + "..."
    }
}

fn strip_code_fences(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let without_start = trimmed
        .split_once('\n')
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    without_start
        .rsplit_once("```")
        .map(|(body, _)| body.trim().to_string())
        .unwrap_or_else(|| without_start.to_string())
}

fn validate_playbook(value: &Value) -> Result<Value, String> {
    let timeline = value
        .get("timeline")
        .and_then(|t| t.as_array())
        .ok_or_else(|| "AI_BAD_PLAYBOOK: 缺少 timeline 数组".to_string())?;
    if timeline.is_empty() {
        return Err("AI_BAD_PLAYBOOK: timeline 为空".into());
    }
    Ok(json!({
        "timeline": timeline,
        "explain": value.get("explain").cloned().unwrap_or(Value::Null),
        "warnings": value.get("warnings").cloned().unwrap_or_else(|| json!([])),
    }))
}

const SYSTEM_PROMPT: &str = "你是嵌入式教学助手。根据用户给出的电路与代码，预测这段代码运行后会发生什么。\n只输出 JSON（不要解释、不要 markdown 代码块），格式：\n{\n  \"timeline\": [ { \"t\": 0, \"leds\": {\"<元件id>\": true}, \"serial\": \"可选文本\", \"note\": \"可选说明\" } ],\n  \"explain\": \"用中文解释这段代码如何驱动电路\",\n  \"warnings\": [ \"可选：接线或代码问题\" ]\n}\n规则：t 是相对开始运行的毫秒数；只对 LED 类元件给 leds 状态；时间轴覆盖至少 3 个事件、最多 40 个；如果代码无法判断，给出空时间轴并在 explain 里说明。";

#[tauri::command]
pub fn get_ai_config(shared: State<'_, Arc<Shared>>) -> AiSettingsView {
    let cfg = shared.config.lock().unwrap();
    AiSettingsView {
        provider: cfg.ai.provider.clone(),
        base_url: cfg.ai.base_url.clone(),
        model: cfg.ai.model.clone(),
        has_key: !cfg.ai.api_key.is_empty(),
        can_write: cfg.ai_can_write,
    }
}

#[tauri::command]
pub fn save_ai_config(shared: State<'_, Arc<Shared>>, settings: SaveAiBody) -> bool {
    if let Ok(mut cfg) = shared.config.lock() {
        cfg.ai.provider = settings.provider;
        cfg.ai.base_url = settings.base_url;
        cfg.ai.model = settings.model;
        if let Some(key) = settings.api_key {
            if !key.trim().is_empty() {
                cfg.ai.api_key = key.trim().to_string();
            }
        }
        let _ = cfg.save();
        return true;
    }
    false
}

#[tauri::command]
pub fn test_ai_connection(shared: State<'_, Arc<Shared>>) -> Result<Value, String> {
    let reply = chat_completion(&shared, "你是连通性测试助手。", "只回复两个字：可用")?;
    Ok(json!({ "ok": true, "reply": truncate(&reply, 120) }))
}

/// 控制面（HTTP）与 Tauri 命令共用的预览实现
pub fn preview_core(shared: &Shared, request: PreviewRequest) -> Result<Value, String> {
    let circuit = serde_json::to_string_pretty(&request.circuit).unwrap_or_else(|_| "{}".into());
    let user = format!(
        "板卡：{}\n\n电路（JSON）：\n{}\n\n代码（{}）：\n{}\n",
        request.board_kind.unwrap_or_else(|| "unknown".into()),
        truncate(&circuit, 6000),
        request.language,
        truncate(&request.code, 6000)
    );
    let content = chat_completion(shared, SYSTEM_PROMPT, &user)?;
    let cleaned = strip_code_fences(&content);
    let parsed: Value = serde_json::from_str(&cleaned).map_err(|e| format!("AI_BAD_JSON: {e}"))?;
    validate_playbook(&parsed)
}

#[tauri::command]
pub fn ai_preview(shared: State<'_, Arc<Shared>>, request: PreviewRequest) -> Result<Value, String> {
    preview_core(&shared, request)
}
