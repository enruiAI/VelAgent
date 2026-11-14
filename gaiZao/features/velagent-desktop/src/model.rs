//! 电路数据模型 —— 与旧版 .vlx 格式兼容的最小集合。
//!
//! 设计原则：**连线只表达"元件的哪个引脚"，不表达像素坐标**。
//! 画布按 pin table 计算坐标，用户拖动后自动跟随。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Board {
    pub id: String,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Component {
    pub id: String,
    pub metadata_id: String,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub rotation: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_on: Option<String>,
    #[serde(default)]
    pub properties: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinRef {
    pub owner_id: String,
    pub pin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wire {
    pub id: String,
    pub from: PinRef,
    pub to: PinRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Workspace {
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub boards: Vec<Board>,
    #[serde(default)]
    pub components: Vec<Component>,
    #[serde(default)]
    pub wires: Vec<Wire>,
}

impl Workspace {
    pub fn demo() -> Self {
        Workspace {
            revision: 1,
            name: "demo".into(),
            boards: vec![Board {
                id: "b1".into(),
                kind: "rp2040-zero".into(),
                x: 80.0,
                y: 120.0,
                rotation: 0.0,
                name: None,
            }],
            components: vec![],
            wires: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogItem {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin_count: Option<u32>,
}

pub fn board_catalog() -> Vec<CatalogItem> {
    vec![
        CatalogItem { id: "rp2040-zero".into(), name: "RP2040-Zero".into(), category: "boards".into(), pin_count: Some(30) },
        CatalogItem { id: "raspberry-pi-pico".into(), name: "Raspberry Pi Pico".into(), category: "boards".into(), pin_count: Some(40) },
        CatalogItem { id: "arduino-uno".into(), name: "Arduino Uno".into(), category: "boards".into(), pin_count: Some(30) },
    ]
}

pub fn component_catalog() -> Vec<CatalogItem> {
    vec![
        CatalogItem { id: "breadboard".into(), name: "面包板".into(), category: "passive".into(), pin_count: Some(830) },
        CatalogItem { id: "led".into(), name: "LED".into(), category: "output".into(), pin_count: Some(2) },
        CatalogItem { id: "resistor-330".into(), name: "电阻 330Ω".into(), category: "passive".into(), pin_count: Some(2) },
        CatalogItem { id: "pushbutton".into(), name: "按钮".into(), category: "input".into(), pin_count: Some(4) },
        CatalogItem { id: "buzzer".into(), name: "蜂鸣器".into(), category: "output".into(), pin_count: Some(2) },
    ]
}
