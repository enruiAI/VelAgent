# VelAgent ⇄ DeepSeek Harness 画布桥接协议 v1

本文件是「VelAgent 电路画布」与「Harness 原生插件」之间的**唯一接口约定**。宿主端（Host）
与浏览器端（Client）必须严格按本文件实现，任何一端改动都要同步改这份文档。

## 0. 架构

```
┌──────────────────────── dsh web (127.0.0.1:2021) ────────────────────────┐
│  Host 进程                                             浏览器            │
│  ┌────────────────────────────┐        ┌──────────────────────────────┐ │
│  │ ui-velagent 宿主半边        │  HTTP  │ ui-velagent 客户端半边       │ │
│  │ src/index.ts               │ <────> │ src/client/* (右侧 dock)     │ │
│  │  - VelAgentCanvasHub       │        │  - 推快照 / 长轮询取命令      │ │
│  │  - 路由 /velagent/canvas/* │        │  - ack + 回推最新快照         │ │
│  │  - Cordis tools            │        │                              │ │
│  └────────────────────────────┘        │  ┌────────────────────────┐  │ │
│             ▲                          │  │ /velagent-assets/*     │  │ │
│             │  工具调用(模型)            │  │ window.VelAgentEmbed   │  │ │
│        Agent (Harness 模型)             │  └────────────────────────┘  │ │
└──────────────────────────────────────────────────────────────────────────┘
```

- **不额外开端口、不需要 token、不走 MCP、不需要用户配置 AI**：画布就是 Harness 的一个内置插件，
  HTTP 走 Harness 自己的 web server（同源、默认只监听回环地址）。
- **模型凭证完全复用 Harness 现有配置**，插件不读取、不保存任何 Key。

## 1. 浏览器端画布入口：`window.VelAgentEmbed`

由 `gaiZao/features/velagent-ui` 构建出的 `velagent-embed.js`（IIFE）定义，由 `velagent-workbench` 宿主的
`webServer` 前缀路由 `/velagent-assets/*` 发出（不复制进 `apps/web/public`）；加载后可用：

```ts
interface VelAgentEmbedApi {
  version: 3
  /** 把原始 VelAgent 工作台（品牌头 + 活动栏 + 文件树 + 代码/画布分栏 + 状态栏）挂到容器里。 */
  mountWorkspace(element: HTMLElement, options?: {
    onAiRun?: () => void
    /** 工作区文件读写；提供后工作台文件树显示 Harness 会话的真实工作区（与左侧工作区同一个目录）。 */
    workspace?: WorkspaceProvider
  }): () => void
  /** 把电路画布挂到容器里，返回卸载函数（同一页面可有多个挂载点）。 */
  mount(element: HTMLElement): () => void
  /** 把代码编辑器（Monaco + 文件标签）挂到容器里，返回卸载函数。 */
  mountEditor(element: HTMLElement): () => void
  /** 当前工作区快照（纯 JSON，可结构化克隆）。 */
  getState(): WorkspaceSnapshot
  /** 执行一条画布命令，返回命令结果与执行后的最新快照。 */
  executeCommand(command: CanvasCommand): Promise<{ result: unknown; workspace: WorkspaceSnapshot }>
  /** 画布状态变化订阅（内部已去抖），返回取消订阅函数。 */
  subscribe(listener: (state: WorkspaceSnapshot) => void): () => void
  /** 当前编辑器代码：活动文件名 + 全部文件。 */
  getCode(): { active: string | null; files: Array<{ name: string; content: string }> }
  /** 写入代码：name 省略时写当前活动文件；返回实际文件名。 */
  setCode(update: { name?: string; content: string }): Promise<{ name: string }>
  /** 播放一段行为时间轴（LED/串口），返回停止函数。 */
  playTimeline(playbook: TimelinePlaybook): { stop: () => void }
  /** 把当前工作区导出成 .vlx 项目文件（浏览器下载），返回文件名。 */
  exportProject(options?: { name?: string }): { name: string }
}

/** 工作台与 Harness 会话工作区之间的文件桥；路径都是相对工作区根目录的 `/` 分隔路径。 */
interface WorkspaceProvider {
  list(path?: string): Promise<{
    root: string
    name: string
    entries: Array<{ name: string; type: 'file' | 'directory'; bytes?: number }>
  }>
  read(path: string): Promise<{ text: string; version: string }>
  write(path: string, content: string): Promise<{ version: string }>
  /** 以下为可选能力；未提供时文件树隐藏对应操作。 */
  mkdir?(path: string): Promise<void>
  rename?(from: string, to: string): Promise<void>
  remove?(path: string): Promise<void>
}

interface TimelinePlaybook {
  timeline: Array<{ t: number; leds?: Record<string, boolean>; serial?: string; note?: string }>
  explain?: string
  warnings?: string[]
}

interface WorkspaceSnapshot {
  /** 单调递增：每次画布变化 +1；客户端用它和宿主去重（只推变化过的快照）。 */
  revision: number
  name: string
  boards: Array<{ id: string; ref?: string; kind: string; x: number; y: number; rotation: number; name?: string }>
  components: Array<{ id: string; ref?: string; metadata_id: string; x: number; y: number; rotation: number; properties: Record<string, unknown> }>
  wires: Array<{
    id: string
    from: { owner_id: string; pin: string }
    to: { owner_id: string; pin: string }
    color: string
    signal?: string
  }>
}
```

`WorkspaceSnapshot` 与现有 `serializeWorkspace()`（`gaiZao/features/velagent-ui/src/integration/workspaceState.ts`）一致；
`CanvasCommand` 与 `gaiZao/features/velagent-ui/src/integration/commands.ts` 的 `executeCommand` 一致（见 §4）。

## 2. 宿主 HTTP 路由（同一 web server，前缀 `/velagent/canvas`）

请求/响应均为 JSON；未声明字段忽略；请求体上限 4 MiB。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| POST | `/velagent/canvas/snapshot` | `{ sessionId?: string, revision: number, workspace: WorkspaceSnapshot }` | `204` |
| POST | `/velagent/canvas/ack` | `{ sessionId?: string, opId: string, ok: boolean, result?: unknown, error?: string, workspace?: WorkspaceSnapshot }` | `204` |
| GET | `/velagent/canvas/ops?sessionId=&cursor=&wait=20000` | — | `{ cursor: number, ops: Array<{ id: string, command: CanvasCommand }> }` |
| GET | `/velagent/canvas/state?sessionId=` | — | `{ connected: boolean, revision: number, workspace: WorkspaceSnapshot \| null }` |
| GET | `/velagent/workspace/list?sessionId=&path=` | — | `{ ok, root, name, entries: Array<{ name, type, bytes? }> }` |
| GET | `/velagent/workspace/read?sessionId=&path=` | — | `{ ok, path, text, version, bytes? }` |
| POST | `/velagent/workspace/write` | `{ sessionId, path, content }` | `{ ok, version, operation }` |
| POST | `/velagent/workspace/mkdir` | `{ sessionId, path }` | `{ ok }` |
| POST | `/velagent/workspace/rename` | `{ sessionId, from, to }` | `{ ok }` |
| POST | `/velagent/workspace/delete` | `{ sessionId, path }` | `{ ok }` |
| GET | `/velagent/canvas/health` | — | `{ ok: true, sessions: Array<{ sessionId: string, revision: number, ageMs: number, connected: boolean, pending: number }>, recent: Array<{ at: number, kind: 'enqueue' \| 'ack', requested: string \| null, resolved: string \| null, opId?: string, ok?: boolean }> }` |

约定：

- `sessionId` 缺省时宿主落到匿名会话 `@unbound`；工具侧优先按 `exec.agent.session.id` 精确匹配，
  匹配不到时如果只有 1 个已连接的画布则回退到它，否则返回 `canvas_not_connected`。
- 宿主只在内存里保存快照与队列（不落盘、不进 session 日志），进程重启后由客户端重新推基线快照。
- 长轮询：没有待执行命令时最多挂起 `wait` 毫秒（上限 25000），超时返回空列表。
- 每次 `POST snapshot` 覆盖宿主保存的该会话快照；`POST ack` 若带 `workspace` 同样覆盖。
- 客户端断线由 `ageMs` 判断（>15s 视为未连接）。

## 3. 宿主 Cordis 工具（模型可见，全局注册）

工具名前缀 `velagent_`；全部要求画布已连接，否则返回结构化错误
`{ ok:false, error:'canvas_not_connected', message:'...' }`（模型可读、可恢复：提示用户打开右侧画布）。

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `velagent_read_circuit` | `{ full?: boolean }` | `{ ok:true, revision, boards, components, wires, summary }`（每行都带 `ref`） |
| `velagent_place_board` | `{ kind: string, x?, y?, name?, ref? }` | `{ ok:true, id, ref, pins }`（pins = 真实引脚名） |
| `velagent_place_component` | `{ metadata_id, x?, y?, rotation?, properties?, seat_on?, ref? }` | `{ ok:true, id, ref, pins }` |
| `velagent_update_component` | `{ id: string \| ref, patch: { x?, y?, rotation?, properties? } }` | `{ ok:true }` |
| `velagent_remove_component` | `{ id: string \| ref }` | `{ ok:true }` |
| `velagent_connect` | `{ from:{ owner_id? \| ref?, pin }, to:{ owner_id? \| ref?, pin }, color?, signal? }` | `{ ok:true, id, from, to }`；引脚不存在时返回 `ok:false` + 可用引脚列表 |
| `velagent_remove_wire` | `{ id: string }` | `{ ok:true }` |
| `velagent_validate` | `{}` | 校验结果（`ok`, `issues[]`，字段随 VelAgent `validateCircuit` 输出） |
| `velagent_highlight` | `{ owner_id?: string \| ref, pins?: string[], message?: string }` | `{ ok:true }` |
| `velagent_list_components` | `{}` | `{ boards:[{型号,名称}], components:[{型号,名称,分类,参数}] }` |
| `velagent_read_pins` | `{ ref? \| owner_id? }` | `{ owner_id, count, names[] }`（面包板给孔位命名规则） |
| `velagent_read_circuit_json` | `{}` | `{ json, text }`：与 JSON 页签同一份文档 |
| `velagent_apply_circuit_json` | `{ json? \| text? }` | `{ ok, issues[] }`：整份替换，校验失败画布不变 |
| `velagent_clear` | `{}` | `{ ok:true }` |
| `velagent_read_code` | `{}` | `{ ok:true, active, files:[{name,content}] }` |
| `velagent_write_code` | `{ content: string, name?: string }` | `{ ok:true, name }` |
| `velagent_play_timeline` | `{ timeline:[{t,leds?,serial?,note?}], explain?, warnings? }` | `{ ok:true, durationMs }` |
| `velagent_stop_timeline` | `{}` | `{ ok:true }` |

工具执行 = 「把命令投递给浏览器 → 等待 ack」，超时 30s；ack 的 `result` 原样成为工具结果。

变量名（`ref`）与引脚约定：

- 每块板卡 / 元件有唯一 `ref`（如 `U1` / `R1` / `D1` / `B1`），缺省时由画布自动分配（板卡 `U`、面包板 `B`、电阻 `R`、LED `D`…）。
- 工具参数同时接受 `ref` 和画布 id；`place_*` 的结果会直接返回 `ref` 和该元件**真实存在**的引脚名。
- `connect` 会解析别名（`D13` ↔ `13`、`3.3V` ↔ `3V3`、`GND.1` ↔ `GND`）并校验引脚是否存在；面包板孔写行字母+列号（`a5`）。
- `velagent_validate` 新增 `UNKNOWN_PIN` 错误：引用了不存在的引脚会被判为错误（以前会静默接受）。

## 4. 画布命令（`executeCommand` 支持）

命令对象 = `{ op: '<命令名>', ...args }`；**判别字段是 `op`**（不是 type）。
命令实现沿用 `gaiZao/features/velagent-ui/src/integration/commands.ts`：

```
place_board   { kind, x?, y?, name?, ref? }
update_board  { id | ref, patch:{ x?, y?, rotation?, name? } }
remove_board  { id | ref }
place_component { metadata_id, x?, y?, rotation?, properties?, seat_on?, ref? }
update_component { id | ref, patch:{ x?, y?, rotation?, properties? } }
remove_component { id | ref }
connect       { from:{owner_id|ref, pin}, to:{owner_id|ref, pin}, color?, signal? }
remove_wire   { id }
catalog       {}            // 型号目录：boards + components（含参数名）
pins          { owner_id | ref }  // 某个元件的真实引脚名
json_get      {}            // 画布 → 电路 JSON：{ json, text }
json_apply    { json | text }     // 电路 JSON → 画布：{ ok, issues[] }
undo | redo
highlight     { owner_id?, pins?, message? }
view          { target }
validate      {}
batch         { commands: CanvasCommand[], atomic?: boolean }
clear         {}            // 清空画布（板卡+元件+连线）
code_get      {}            // 读编辑器：{ active, files }
code_set      { name?, content }   // 写编辑器：{ name }
timeline_play { timeline, explain?, warnings? }  // 播放行为时间轴：{ durationMs }
timeline_stop {}            // 停止播放
export_project { name? }    // 导出 .vlx：{ name }
```

## 4.1 电路 JSON（人机共创）

画布工具条新增 **JSON** 页签（与 代码 / 分栏 / 电路 并列）。它展示当前画布的电路 JSON，
人和 AI 用的是同一份文档：人改完点「应用到画布」，AI 通过 `velagent_apply_circuit_json` 应用；
画布被拖拽或 AI 用工具改动时，页签在没有未应用编辑的情况下自动同步。

格式（中文键，`版本: 1`）：

```jsonc
{
  "版本": 1,
  "名称": "workspace",
  "元件": [
    { "编号": "U1", "型号": "arduino-uno", "位置": [50, 50] },
    { "编号": "B1", "型号": "breadboard", "位置": [300, 200] },
    { "编号": "R1", "型号": "resistor", "插在": { "1": "B1.a5", "2": "B1.a11" }, "参数": { "value": "220" } },
    { "编号": "D1", "型号": "led", "插在": { "A": "B1.a1" }, "参数": { "color": "blue" } }
  ],
  "连线": [ { "起点": "U1.13", "终点": "R1.1", "颜色": "#22c55e" } ],
  "网络": [ { "引脚": ["U1.13", "R1.1"] } ]
}
```

- `元件`：每个板卡 / 元件一行，平铺；`位置` 与 `插在` 二选一（插在面包板孔里就不写坐标）。
- `插在`：键 = 元件自己的引脚名，值 = `面包板编号.孔位`（孔位用行字母+列号，如 `a5`）。
- `连线`：一条线一行，两端写 `编号.引脚`；只按第一个点切分（引脚名可以带点，如 `GND.1`）。
- `网络`：由「连线 + 面包板内部同列/电源轨连通」推导出来的电气网络，方便人核对；可省略。
- 应用是原子的：结构/类型/编号/重复线校验失败时画布保持原样；写入后若发现引脚不存在会回滚。
- 导入时 `插在` 以第一个引脚对齐到声明孔位，其余引脚按元件真实几何吸附；导出的 `插在` 反映画布实际吸附结果。

## 5. 客户端同步循环

1. dock 打开 → 动态加载 `/velagent-assets/velxio-ui.css` 与 `/velagent-assets/velagent-embed.js`，`mount(container)`。
2. `subscribe` 状态变化 → 120ms 去抖 → `POST snapshot { sessionId, revision, workspace }`。
3. 循环 `GET ops?sessionId&cursor&wait=20000`：
   - 有命令 → 逐条 `executeCommand` → `POST ack { sessionId, opId, ok, result|error, workspace }`；
   - 空列表 → 继续下一次长轮询。
4. dock 关闭 → 停止轮询与推送（服务端 15s 后判定断线）。

## 6. 失败与边界

- 画布未连接：工具返回 `canvas_not_connected`，不阻塞模型继续对话。
- 命令执行抛错：ack `ok:false, error:<message>`，工具以结构化错误返回同样的 message。
- 同一命令只会执行一次（opId 由宿主单调分配，客户端 ack 幂等）。
- 客户端重连后 cursor 归零重来；已交付但未 ack 的命令不会重投（ack 按 opId 幂等）。
- 宿主 15s 收不到快照即视为该画布断开；工具此时返回 `canvas_not_connected` 而不是挂起。

## 7. 自检

```powershell
# 协议+静态产物（在 VelAgent/ 下）
node scripts/verify-canvas-bridge.mjs http://127.0.0.1:2021

# 真实浏览器端到端（Edge headless + CDP；打开会话 → dock 工作台 → 点「AI 运行」→ 等工具 ack）
node scripts/verify-workspace-airun.mjs "http://127.0.0.1:2021/?token=<token>"

# 会话日志解读（zstd 多帧解码；排查回合失败/工具调用）
node scripts/diagnose-session-log.mjs "$env:APPDATA\Enrui\VelAgent\data\harness-home\sessions"
```

画布默认工作区自带 1 块 Arduino Uno、2 个板载元件（LED/电阻）、3 根线，用于开箱演示；
`velagent_clear` 之后才是全空画布。
