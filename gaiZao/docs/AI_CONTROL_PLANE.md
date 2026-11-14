> **历史/背景文档**：部分内容描述迁移前的架构（Tauri 主导、资产复制进 public 等）。
> 当前架构以 [gaiZao/README.md](../README.md) 与 [2026-11-13-migration.md](./2026-11-13-migration.md) 为准。

# AI 控制面（AI Control Plane）规格 v1

> 目标：让 Claude Code / Codex / Cursor / 自研 agent 这类 harness 通过本地接口操作 VelAgent 画布，与用户实时共创。
> 状态：**已实现**（M0 只读 + M1 写操作/校验/SSE + M2 MCP + M3 运行预测）。

## 1. 概览

- 服务地址：`http://127.0.0.1:7317`（端口固定，冲突时顺延并在界面显示实际端口）
- 同进程内运行（Rust → axum），不依赖任何外部服务；
- 接入方式：
  1. **HTTP + OpenAPI**：任何能发 HTTP 的 harness 都能用；
  2. **MCP**：同一套能力包一层 MCP 工具（stdio / SSE），Claude Code、Cursor 等原生支持；
  3. **AI 指南**：`GET /llms.txt` 与 `/api/v1/ai-guide.md` 给出工作流、引脚语义、常见错误与示例。
- 文档与实现同源：OpenAPI 由 Rust 类型生成（M0 先手写占位，M1 换成生成）。

## 1.1 接入方式（两种）

```bash
# 方式 A：HTTP（任何 harness / curl）
curl http://127.0.0.1:7317/health
curl -H "Authorization: Bearer <token>" http://127.0.0.1:7317/api/v1/state
curl http://127.0.0.1:7317/llms.txt

# 方式 B：MCP（Claude Code / Cursor / Codex 等）
# 把下面这行作为 MCP server 命令加进你的 harness 配置：
C:\path\to\VelAgent.exe --mcp-stdio
```

MCP 工具与 HTTP 端点一一对应（tools/list 可见完整 JSON Schema）。

> 写操作需要在应用「AI 控制台」里勾选 **允许 AI 修改画布**；默认只读，避免任何本机进程偷偷改画布。

## 2. 认证与安全

- 所有 `/api/v1/*` 请求必须携带 `Authorization: Bearer <token>`；
- Token 首次启动随机生成，存于本地配置，界面可查看/复制/轮换；
- 仅监听 `127.0.0.1`；不开启 CORS；不监听 IPv6 外网；
- 设置里可切换 **只读模式**（AI 只能读、不能改）；
- 所有写操作写入审计日志（环形缓冲，界面可查，可按 batch 撤销）；
- 破坏性操作（删除板卡/清空画布）需要 `confirm: true`。

## 3. 核心数据结构

```jsonc
// GET /api/v1/state
{
  "revision": 42,                     // 单调递增，用于乐观并发
  "boards": [
    { "id": "b1", "kind": "rp2040-zero", "x": 80, "y": 120, "rotation": 0 }
  ],
  "components": [
    { "id": "c1", "metadataId": "breadboard", "x": 360, "y": 120, "rotation": 0, "properties": {} },
    { "id": "c2", "metadataId": "led", "seatOn": "c1:a3", "x": 0, "y": 0, "properties": { "color": "red" } },
    { "id": "c3", "metadataId": "resistor-330", "seatOn": "c1:b1", "x": 0, "y": 0, "properties": {} }
  ],
  "wires": [
    { "id": "w1", "from": { "boardId": "b1", "pin": "GP2" },
      "to": { "componentId": "c3", "pin": "1" }, "color": "#ff3b30", "signal": "digital" }
  ],
  "selection": ["c2"]
}
```

要点：**连线只表达"哪个元件的哪个引脚"，不表达像素坐标**。坐标由画布按 pin table 计算；用户拖动元件后自动跟随。

## 4. 端点（v1）

### 只读

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活、版本、端口 |
| GET | `/api/v1/state` | 画布全量状态（含 revision） |
| GET | `/api/v1/catalog/boards` | 可放板卡（id/名称/引脚数/尺寸） |
| GET | `/api/v1/catalog/components` | 可放元件（id/名称/分类/引脚列表） |
| GET | `/api/v1/boards/{id}/pins` | 指定板卡/元件的引脚表（名称/角色/坐标） |
| GET | `/api/v1/events` | SSE：画布变更事件流 |
| GET | `/llms.txt` | 给 AI 的总指南 |
| GET | `/api/v1/openapi.json` | OpenAPI 3.1 |

### 写操作

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/boards` | 放板卡：`{kind}` 或 `{kind, x, y}` |
| PATCH | `/api/v1/boards/{id}` | 移动/旋转/改名 |
| DELETE | `/api/v1/boards/{id}` | 删除（需 confirm） |
| POST | `/api/v1/components` | 放元件：`{metadataId, seatOn?}` 或 `{metadataId, x, y}` |
| PATCH | `/api/v1/components/{id}` | 移动/旋转/改属性 |
| DELETE | `/api/v1/components/{id}` | 删除（需 confirm） |
| POST | `/api/v1/wires` | 连线：`{from:{boardId,pin}, to:{componentId,pin}}` |
| DELETE | `/api/v1/wires/{id}` | 删除线 |
| POST | `/api/v1/batch` | 原子批量：一次请求做多步，返回 `revision` 与可撤销 id |
| POST | `/api/v1/validate` | 接线校验，返回错误/警告 |
| POST | `/api/v1/highlight` | 高亮引脚/元件（教学） |
| POST | `/api/v1/view` | 聚焦/缩放/居中 |
| POST | `/api/v1/steps` | 载入教学步骤计划 |
| POST | `/api/v1/undo` / `redo` | 撤销/重做 |

### 运行预测（已实现）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/run/preview` | 提交代码+电路，返回 AI 行为剧本（时间轴 JSON）；需要用户先在 AI 设置里配置 Key |

## 5. 摆放与连线规则（给 AI 的"语义坐标"）

- **板卡**：`POST /boards {kind:"rp2040-zero"}`；可用 `position:"left"|"center"|"right"` 自动摆放；
- **面包板**：作为普通元件 `metadataId:"breadboard"`；孔名格式 `a1`~`j30`（列字母 a–j，行号 1–30，中间沟槽隔开）；
- **插在面包板上**：`seatOn: "<breadboardId>:<hole>"`，例如 `seatOn:"c1:a3"`；电阻两端用 `"1"`/`"2"` 或孔名接线；
- **连线**：只允许 pin→pin；同一引脚被占用返回 `PIN_IN_USE`；GPIO 直连 GND/VCC 返回 `SHORT_RISK`；
- **颜色语义**（可选，AI 不必填）：电源红、地黑、信号绿、SPI 橙、I2C 蓝。

## 6. 校验（`POST /validate`）

返回：

```json
{
  "ok": false,
  "errors": [
    { "code": "MISSING_RESISTOR", "severity": "error",
      "message": "LED 没有串联限流电阻，直接接 GPIO 会过流。",
      "hint": "在 GP2 和 LED 长脚之间串一个 220Ω–1kΩ 电阻。",
      "refs": { "components": ["c2"], "wires": ["w1"] } }
  ],
  "warnings": []
}
```

错误码（首发）：

| code | 含义 |
| --- | --- |
| `PIN_NOT_FOUND` | 引脚名不存在（含可用值列表） |
| `PIN_IN_USE` | 同一引脚接多根线 |
| `NO_GROUND` | 电路没有共地 |
| `LED_REVERSED` | LED 极性接反 |
| `MISSING_RESISTOR` | LED/蜂鸣器缺少限流电阻 |
| `SHORT_RISK` | 电源与地之间直连 |
| `GPIO_TO_GND` | GPIO 直连 GND |
| `BREADBOARD_ROW_OPEN` | 以为连通但跨了沟槽/不同排 |
| `UNKNOWN_COMPONENT` | metadataId 不存在 |
| `BOARD_NOT_FOUND` / `COMPONENT_NOT_FOUND` | 引用对象不存在 |

## 7. 事件流（SSE）

`GET /api/v1/events` 推送增量事件，AI 可据此与用户实时协同：

```text
event: wire.added
data: {"revision":43,"wire":{"id":"w2","from":{"boardId":"b1","pin":"GND"},"to":{"componentId":"c1","pin":"b30"}}}

event: component.moved
data: {"revision":44,"id":"c2","x":420,"y":180,"by":"user"}
```

事件类型：`board.added/removed`、`component.added/removed/moved/props`、`wire.added/removed`、`selection.changed`、`run.preview`、`user.edit`。

## 8. 错误响应格式（全局）

```json
{ "error": { "code": "PIN_NOT_FOUND", "message": "GP20 不存在", "hint": "可用引脚：GP0–GP13, GP26–GP29, 3V3, GND", "docs": "/api/v1/boards/b1/pins" } }
```

HTTP 状态码：400 参数错、401 未带 token、403 只读模式、404 对象不存在、409 版本冲突、422 校验失败。

## 8.1 运行预测请求/响应（已实现）

```jsonc
// POST /api/v1/run/preview
{
  "code": "void loop(){digitalWrite(13,HIGH);delay(500);}",
  "language": "arduino",
  "board_kind": "arduino-uno",
  "circuit": { "boards": [], "components": [], "wires": [] }
}
// => 200
{
  "timeline": [
    { "t": 0,   "leds": { "<ledId>": true }, "serial": "on" },
    { "t": 500, "leds": { "<ledId>": false } }
  ],
  "explain": "每 500ms 翻转一次 GPIO13",
  "warnings": []
}
```

未配置 AI Key 时返回 502 `AI_PREVIEW_FAILED / AI_NOT_CONFIGURED`；界面会自动降级为本地规则预测。

## 9. MCP 映射

| MCP 工具 | 对应 HTTP |
| --- | --- |
| `velagent_state` | GET /state |
| `velagent_catalog` | GET /catalog/* |
| `velagent_place_board` | POST /boards |
| `velagent_place_component` | POST /components |
| `velagent_connect` | POST /wires |
| `velagent_validate` | POST /validate |
| `velagent_batch` | POST /batch |
| `velagent_highlight` | POST /highlight |
| `velagent_load_steps` | POST /steps |
| `velagent_run_preview` | POST /run/preview（M3） |

启动方式：`VelAgent.exe --mcp-stdio`（由 harness 拉起，stdio JSON-RPC）。

Claude Code 示例：

```bash
claude mcp add velagent -- "C:\\path\\to\\VelAgent.exe" --mcp-stdio
```

Cursor / 其它客户端：在 MCP 配置里加一个 stdio server，command 指向 `VelAgent.exe`，args 为 `["--mcp-stdio"]`。

## 10. `/llms.txt`（AI 指南）大纲

1. 你是谁、能操作什么（画布/元件/连线/校验/步骤）；
2. 工作流：读 `state` → 读 `catalog` → 用 `batch` 一次性放置 → `validate` → 向用户解释；
3. 引脚语义表（板卡引脚 + 元件引脚：LED A/C、电阻 1/2、按键 1.l/2.l…）；
4. 面包板规则（同排 5 孔互通、沟槽隔断、电源轨）；
5. 常见错误与修复（对应错误码）；
6. 三条完整示例（闪烁 / 并联两灯 / TFT 接线）；
7. 禁止事项：不要编造引脚名、不要假设坐标、不要一次删掉整个画布；
8. 交互约定：改完必须调用 `validate`，并把结果翻译成人话告诉用户。

## 11. 版本与兼容

- 路径版本化 `/api/v1`；新增字段允许，删除/改名走 v2；
- 未知字段忽略，避免 harness 因版本差异失败；
- `revision` 用于乐观并发：写请求可带 `If-Match: <revision>`，冲突返回 409 并附当前状态摘要。
