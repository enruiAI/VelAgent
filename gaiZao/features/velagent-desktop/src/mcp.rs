//! MCP（Model Context Protocol）stdio 服务器：
//! 让 Claude Code / Cursor / Codex 等 harness 直接以工具的形式读写 VelAgent 画布。
//!
//! 启动：velagent.exe --mcp-stdio
//! 它本身不碰画布，而是把工具调用转发给本机正在运行的 VelAgent 控制面（HTTP + Token）。
//!
//! 协议：JSON-RPC 2.0，按行（newline-delimited JSON）读写 stdin/stdout。

use crate::config::Config;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::time::Duration;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into()
}

fn api_call(method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let cfg = Config::load_or_create();
    let url = format!("http://127.0.0.1:{}/api/v1{}", cfg.port, path);
    let token = cfg.token;
    let agent = agent();
    let auth = format!("Bearer {token}");
    let mut response = match method {
        "GET" => agent
            .get(&url)
            .header("Authorization", &auth)
            .call()
            .map_err(|e| format!("CONTROL_API_UNREACHABLE: {e}"))?,
        "DELETE" => agent
            .delete(&url)
            .header("Authorization", &auth)
            .call()
            .map_err(|e| format!("CONTROL_API_UNREACHABLE: {e}"))?,
        "POST" => {
            let text = match body {
                Some(value) => serde_json::to_string(&value).map_err(|e| e.to_string())?,
                None => "{}".to_string(),
            };
            agent
                .post(&url)
                .header("Authorization", &auth)
                .header("Content-Type", "application/json")
                .send(text)
                .map_err(|e| format!("CONTROL_API_UNREACHABLE: {e}"))?
        }
        other => return Err(format!("unsupported method {other}")),
    };
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("CONTROL_API_READ: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("CONTROL_API_BAD_JSON: {e}"))
}

fn tools() -> Value {
    json!([
        {
            "name": "velagent_state",
            "description": "读取当前画布状态：boards（板卡）、components（元件）、wires（连线）、revision。写操作前先读。",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "velagent_catalog",
            "description": "列出可用的板卡与元件 id（放置前必须先查，禁止编造 id）。",
            "inputSchema": {
                "type": "object",
                "properties": { "kind": { "type": "string", "enum": ["boards", "components", "all"], "default": "all" } },
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_place_board",
            "description": "放置一块板卡。kind 取自 catalog；x/y 像素可选（不填则自动摆位）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string" },
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "position": { "type": "string", "enum": ["left", "center", "right"] }
                },
                "required": ["kind"],
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_place_component",
            "description": "放置元件（面包板/LED/电阻/按钮等）。seat_on 形如 breadboardId:a3（字母行+数字列）可直接插到面包板孔位。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "metadata_id": { "type": "string", "description": "元件 id（catalog 里的 id）" },
                    "x": { "type": "number" },
                    "y": { "type": "number" },
                    "seat_on": { "type": "string" },
                    "rotation": { "type": "number" },
                    "properties": { "type": "object" }
                },
                "required": ["metadata_id"],
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_connect",
            "description": "连接两个引脚。owner_id 是板卡或元件 id，pin 是引脚名（板卡：GP2/3V3/GND.1；LED：A/C；电阻：1/2；面包板孔：a1 这类）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from": { "type": "object", "properties": { "owner_id": { "type": "string" }, "pin": { "type": "string" } }, "required": ["owner_id", "pin"] },
                    "to": { "type": "object", "properties": { "owner_id": { "type": "string" }, "pin": { "type": "string" } }, "required": ["owner_id", "pin"] },
                    "color": { "type": "string" },
                    "signal": { "type": "string" }
                },
                "required": ["from", "to"],
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_remove",
            "description": "删除板卡/元件/连线。kind 为 board|component|wire，id 为对象 id。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["board", "component", "wire"] },
                    "id": { "type": "string" }
                },
                "required": ["kind", "id"],
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_validate",
            "description": "校验当前接线，返回 errors / warnings（中文，含修复提示）。改完接线必须调用。",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "velagent_batch",
            "description": "原子批量：一次提交多个命令（place_board/place_component/connect...），全部成功或全部回滚（一次撤销）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "commands": { "type": "array", "items": { "type": "object" } },
                    "atomic": { "type": "boolean", "default": true }
                },
                "required": ["commands"],
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_highlight",
            "description": "在教学时高亮某个元件/引脚，并给用户显示一句话。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "owner_id": { "type": "string" },
                    "pins": { "type": "array", "items": { "type": "string" } },
                    "message": { "type": "string" }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "velagent_undo",
            "description": "撤销上一步（含 AI 的批量操作）。",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

fn call_tool(name: &str, arguments: &Value) -> Result<Value, String> {
    match name {
        "velagent_state" => api_call("GET", "/state", None),
        "velagent_catalog" => {
            let kind = arguments["kind"].as_str().unwrap_or("all");
            if kind == "boards" {
                api_call("GET", "/catalog/boards", None)
            } else if kind == "components" {
                api_call("GET", "/catalog/components", None)
            } else {
                let mut out = json!({});
                out["boards"] = api_call("GET", "/catalog/boards", None)?;
                out["components"] = api_call("GET", "/catalog/components", None)?;
                Ok(out)
            }
        }
        "velagent_place_board" => api_call("POST", "/boards", Some(arguments.clone())),
        "velagent_place_component" => api_call("POST", "/components", Some(arguments.clone())),
        "velagent_connect" => api_call("POST", "/wires", Some(arguments.clone())),
        "velagent_remove" => {
            let kind = arguments["kind"].as_str().unwrap_or("");
            let id = arguments["id"].as_str().unwrap_or("");
            let path = match kind {
                "board" => format!("/boards/{id}"),
                "component" => format!("/components/{id}"),
                "wire" => format!("/wires/{id}"),
                _ => return Err("kind must be board|component|wire".into()),
            };
            api_call("DELETE", &path, None)
        }
        "velagent_validate" => api_call("POST", "/validate", Some(json!({}))),
        "velagent_batch" => api_call("POST", "/batch", Some(arguments.clone())),
        "velagent_highlight" => api_call("POST", "/highlight", Some(arguments.clone())),
        "velagent_undo" => api_call("POST", "/undo", Some(json!({}))),
        other => Err(format!("unknown tool: {other}")),
    }
}

fn respond(id: &Value, result: Value) {
    let payload = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{}", payload);
    let _ = stdout.flush();
}

fn respond_error(id: &Value, code: i64, message: &str) {
    let payload = json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } });
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{}", payload);
    let _ = stdout.flush();
}

pub fn run_stdio() -> i32 {
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let method = message["method"].as_str().unwrap_or("");
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let has_id = !id.is_null();

        match method {
            "initialize" => {
                if has_id {
                    respond(&id, json!({
                        "protocolVersion": "2024-11-05",
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": "velagent", "version": env!("CARGO_PKG_VERSION") }
                    }));
                }
            }
            "notifications/initialized" => {}
            "ping" => {
                if has_id {
                    respond(&id, json!({}));
                }
            }
            "tools/list" => {
                if has_id {
                    respond(&id, json!({ "tools": tools() }));
                }
            }
            "tools/call" => {
                if has_id {
                    let params = &message["params"];
                    let name = params["name"].as_str().unwrap_or("");
                    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
                    match call_tool(name, &arguments) {
                        Ok(value) => {
                            respond(&id, json!({
                                "content": [ { "type": "text", "text": serde_json::to_string_pretty(&value).unwrap_or_default() } ],
                                "isError": false
                            }));
                        }
                        Err(err) => {
                            respond(&id, json!({
                                "content": [ { "type": "text", "text": format!("调用失败：{err}") } ],
                                "isError": true
                            }));
                        }
                    }
                }
            }
            _ => {
                if has_id {
                    respond_error(&id, -32601, &format!("method not found: {method}"));
                }
            }
        }
    }
    0
}
