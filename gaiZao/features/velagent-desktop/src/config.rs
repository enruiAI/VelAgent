//! 本地配置与令牌。API Key 的持久化（系统凭据管理器）在 M3 接入。

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub port: u16,
    pub token: String,
    #[serde(default)]
    pub ai_can_write: bool,
    #[serde(default)]
    pub ai: AiConfig,
    #[serde(default)]
    pub harness: HarnessConfig,
}

/// 内嵌 DeepSeek Harness 的本地配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarnessConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// deepseek-harness 源码/安装目录；空则自动探测。
    #[serde(default)]
    pub repo_path: String,
    /// bridge.mjs 路径；空则自动探测。
    #[serde(default)]
    pub bridge_path: String,
    /// Node 可执行文件；空则用 PATH 里的 node。
    #[serde(default)]
    pub node_path: String,
    #[serde(default = "default_harness_provider")]
    pub provider: String,
    #[serde(default = "default_harness_model")]
    pub model: String,
}

fn default_true() -> bool {
    true
}
fn default_harness_provider() -> String {
    "deepseek-official".into()
}
fn default_harness_model() -> String {
    "deepseek-v4-flash".into()
}

impl Default for HarnessConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            repo_path: String::new(),
            bridge_path: String::new(),
            node_path: String::new(),
            provider: default_harness_provider(),
            model: default_harness_model(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiConfig {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}

fn config_path() -> Option<PathBuf> {
    directories::ProjectDirs::from("ai", "enrui", "VelAgent")
        .map(|d| d.config_dir().join("config.json"))
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 7317,
            token: format!("vlx_{}", uuid::Uuid::new_v4().simple()),
            ai_can_write: false,
            ai: AiConfig::default(),
            harness: HarnessConfig::default(),
        }
    }
}

impl Config {
    pub fn load_or_create() -> Self {
        let Some(path) = config_path() else { return Config::default() };
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<Config>(&text) {
                return cfg;
            }
        }
        let cfg = Config::default();
        let _ = cfg.save();
        cfg
    }

    pub fn save(&self) -> Result<()> {
        let Some(path) = config_path() else { return Ok(()) };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn rotate_token(&mut self) {
        self.token = format!("vlx_{}", uuid::Uuid::new_v4().simple());
        let _ = self.save();
    }
}
