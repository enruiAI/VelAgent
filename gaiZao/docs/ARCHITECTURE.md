> **历史/背景文档**：部分内容描述迁移前的架构（Tauri 主导、资产复制进 public 等）。
> 当前架构以 [gaiZao/README.md](../README.md) 与 [2026-11-13-migration.md](./2026-11-13-migration.md) 为准。

# VelAgent 架构说明（修订版 2026-11-11）

> **重要变更**：放弃"纯 Rust 原生 UI"方案，改为 **复用上游 React 组件前端 + Rust 后端**。
> 原因：上游的元件库（154 元件 / 30 板卡）是 Web Components + SVG，视觉丰富、可直接复用；
> 用 egui 重画会失去它们，也违背"别把项目搞太大"的初衷。Rust 只放在真正需要的地方：
> 本地 AI 控制面、AI 网关、校验、打包与系统集成。

## 1. 目标（不变）

- 零环境依赖：用户只装一个 App，不需要 Python / Docker / arduino-cli；
- 低配电脑能跑：4~8GB 内存的普通办公本；
- **AI 可操作**：本地控制面（HTTP + MCP），主流 harness 可读写画布；
- 人机共创：AI 搭、用户改，状态实时同步；
- 复用上游优秀的前端元件库（这是本项目的核心资产）。

## 2. 非目标

- 不做本地仿真（无 QEMU / AVR / ESP32 模拟）；
- 不做编译器（AI 只做行为预测/解释）；
- 不做云端账号体系。

## 3. 技术选型（修订）

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面壳 | **Tauri 2** | 复用系统 WebView2（Win10/11 自带），安装包小、无 Electron 级内存开销 |
| 前端 | **现有 React + Vite 工程**（`gaiZao/features/velagent-ui/`） | 直接复用 154 元件 / 30 板卡 / 面包板 / TFT 的 Web Components 与 SVG 素材，视觉与上游一致 |
| 后端/系统层 | **Rust（gaiZao/tauri）** | 本地控制面（axum）、AI 网关、Key 安全存储、校验规则、文件、自动更新 |
| 数据格式 | `.vlx`（JSON） | 与旧版兼容，便于导入已有项目 |
| 代码编辑器 | 沿用 Monaco（前端） | 已在前端里，无需重写；后续可换 CodeMirror 减体积 |

**被否决的方案**：

- ❌ 纯 egui/iced 原生 UI：要重画全部元件、失去 Monaco、中文输入/排版成本高，实际项目会变大；
- ❌ 完全重写为 Leptos/Dioxus：仍依赖 WebView，画布交互与 Web Components 互操作复杂，收益低。

## 4. 运行时架构

```
┌───────────────────────────── VelAgent 桌面应用 ─────────────────────────────┐
│  WebView2（Windows 自带）                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ React UI（现有 gaiZao/features/velagent-ui/）                                            │  │
│  │  · 画布 / 元件库 / 属性面板 / 代码编辑器 / 中文界面                   │  │
│  │  · AI 控制台面板（地址 / Token / 开关 / 日志）                        │  │
│  │  · 与 Rust 通信：Tauri invoke（同步状态）+ event（接收 AI 指令）      │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  │ Tauri IPC                                │
│  ┌───────────────────────────────▼──────────────────────────────────────┐  │
│  │ Rust 后端（gaiZao/tauri）                                                │  │
│  │  · 本地控制面 axum: http://127.0.0.1:7317  (/api/v1/*, /llms.txt)      │  │
│  │  · 画布状态镜像（前端推送，供 AI 读取）                                │  │
│  │  · 指令队列：AI 写请求 → 校验 → 通过 Tauri event 让前端执行            │  │
│  │  · AI 网关：用户自配服务商 / Key（系统凭据管理器）/ 剧本缓存           │  │
│  │  · 接线校验规则 / 项目文件 / 更新器                                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 一次 AI 写操作的完整链路

1. harness 调 `POST /api/v1/wires`（带 Bearer Token）；
2. Rust 校验参数与权限（只读开关 / 规则），生成指令并压入队列；
3. Rust 向前端发 Tauri event：`velagent://command`；
4. 前端在 store 执行（放置/连线），并 `invoke('sync_workspace')` 回传新状态；
5. Rust 更新镜像、写审计日志，HTTP 返回 `revision`；
6. 用户也可以直接拖拽；前端同样回传状态，AI 通过 `GET /state` 或 SSE 看到变化。

## 5. 体积与性能预算

| 指标 | 预算 | 说明 |
| --- | --- | --- |
| Windows 安装包 | ≤ 20 MB | Tauri exe（~8MB）+ 前端 dist（~25MB，可再裁素材） |
| 空闲内存 | ≤ 250 MB | WebView2 进程开销；4GB 机器可用 |
| 50 元件画布 | ≤ 400 MB | 浏览器渲染，远低于 Electron |
| 冷启动 | ≤ 2 s | |
| 运行时依赖 | 无 | WebView2 系统自带；不需要 Python/Node/Docker |

## 6. 仓库结构

```
VelAgent/
├─ gaiZao/                      # ★ 我们的全部改造（与上游隔离，便于跟新）
│  ├─ chajian/
│  │  ├─ ui-velagent/           # Harness 内置插件（宿主桥 + 右侧 dock）
│  │  └─ velxio-ui/             # Velxio 改写的画布/编辑器前端
│  ├─ tauri/                    # Rust 后端（Tauri 2，备用形态）
│  │  ├─ Cargo.toml
│  │  ├─ tauri.conf.json
│  │  ├─ capabilities/
│  │  └─ src/                   # main / bridge / control / model / config / ai / validate
│  ├─ scripts/                  # 安装到 Harness、构建、自检
│  └─ docs/                     # 文档（本目录）
└─ 其它：LICENSE / NOTICE / LICENSE_NOTICE / THIRD_PARTY_NOTICES
```

## 7. 低配优化

- 前端按需加载：Monaco 用本地资源，画布组件懒渲染（上游已做 near-viewport 优化）；
- 素材裁剪：`public/` 只留实际用到的板卡/元件；
- WebView2 共享系统运行时，不随包分发浏览器内核；
- 空闲时不轮询：控制面是事件驱动的；
- AI 行为剧本本地缓存，重复运行不耗 API。

## 8. 安全

- 控制面仅绑 127.0.0.1 + Bearer Token（见 AI_CONTROL_PLANE.md）；
- Token 存本地配置；AI API Key 存系统凭据管理器（Windows Credential Manager）；
- "允许 AI 修改画布"开关；审计日志；破坏性操作需 confirm。

## 9. 里程碑

见 [ROADMAP.md](ROADMAP.md)。
