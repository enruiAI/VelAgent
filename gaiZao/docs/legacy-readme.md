# VelAgent

VelAgent 是一个**电路实验 + AI 编程工作台**项目，由两块组成：

1. **电路画布 / 编辑器前端**：开源项目 [Velxio](https://github.com/davidmonterocrespo24/velxio) 前端的
   大量删改版——只保留界面（Monaco 编辑器 + 电路画布 + 元件库），没有后端、没有编译、没有仿真；
2. **AI 宿主**：开源项目 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
   VelAgent 品牌化 + 深度集成版——Agent、会话、工具、Web GUI、模型接入全部复用 Harness，
   并通过内置插件 `ui-velagent` 把电路画布原生嵌进 Harness 右侧 dock（不是 iframe、不是独立窗口）。

> **状态**：Tauri 2 桌面端（Rust 控制面 + MCP）可用；Harness 集成版为当前主线：
> 画布作为 Harness 内置插件原生渲染，Agent 用 Harness 自己的模型与工具实时读写画布，
> **不需要单独配置 AI Key / 端口 / Token / MCP**。
> 设计文档：[架构](gaiZao/docs/ARCHITECTURE.md) · [AI 控制面](gaiZao/docs/AI_CONTROL_PLANE.md) ·
> [画布桥接协议](gaiZao/docs/canvas-bridge-contract.md) · [路线图](gaiZao/docs/ROADMAP.md)。

![编辑器界面](gaiZao/features/velagent-ui/docs/screenshot-editor-zh.png)

## 仓库结构

```
velxio开发/                    # 工作区根目录
├─ VelAgent/                    # ← 本仓库（git）
│  ├─ start.cmd / start.ps1     # 一键启动（单应用、单端口 2021）
│  ├─ gaiZao/                   # ★ 我们对两个上游的全部改造
│  │  ├─ chajian/               # 插件（可复用的改造单元）
│  │  │  ├─ ui-velagent/        # Harness 内置插件：宿主桥 + 右侧工作台 dock
│  │  │  └─ velxio-ui/          # Velxio 改写的画布/编辑器前端（构建 embed 资产）
│  │  ├─ tauri/                 # 独立桌面壳（没有 Harness 时的备用形态）
│  │  ├─ scripts/               # 安装到 Harness / 构建 / 自检脚本
│  │  ├─ docs/                  # 架构、协议、路线图等文档
│  │  └─ harness-bridge/        # 早期桥接（备查）
│  ├─ LICENSE_NOTICE/           # 上游原版许可证与声明（不要删除）
│  ├─ LICENSE / NOTICE.md / THIRD_PARTY_NOTICES.md
│  └─ README.md
├─ deepseek-harness/            # DeepSeek Harness 源码副本（同级目录，不随 git 提交）
└─ ...
```

## 运行（单应用，主线）

产品是**一个应用**：品牌化 DeepSeek Harness + 内置 `ui-velagent` 插件。
启动一次、只占一个端口（2021）。点页面顶部的 **⚡ VelAgent 工作台**（或左下角 **⚡ VelAgent**），
最初那个 VelAgent 界面（品牌头 / 菜单 / 活动栏 / 文件树 / 代码+画布分栏 / AI 运行 / 导出 .vlx / 状态栏）
会作为右侧原生面板展开——对话和工作台在同一个页面里，**不需要再启动第二个服务或窗口**。
工作台左侧文件树显示的就是当前会话的 **Harness 工作区**（与 Harness 左侧「工作区」同一个目录），
标题只显示该文件夹的名字；像 VSCode 一样支持**新建文件 / 新建文件夹 / 重命名 / 删除**，
在里面改代码会写回磁盘，Agent 或外部改动也会自动刷新。

![原版工作台嵌入 Harness](gaiZao/docs/debug-integration-workspace.png)

```
双击 start.cmd            # Windows 一键启动（已在运行则只打开页面）
```

也可以在终端：

```powershell
.\start.ps1
```

首次运行前需要构建（见下）。启动脚本会使用隔离的数据目录 `%APPDATA%\Enrui\VelAgent\data\harness-home`，
模型凭证复用本机已有配置：优先环境变量 `DEEPSEEK_API_KEY`，其次 `%APPDATA%\Enrui\VelAgent\api-key.txt`
（首次启动会自动从本机记录里取一次）；也可以在页面 设置 → 模型 里填写。
**不需要单独配置端口 / Token / MCP**。
架构与协议见 [docs/HARNESS_INTEGRATION.md](gaiZao/docs/HARNESS_INTEGRATION.md) 与
[docs/canvas-bridge-contract.md](gaiZao/docs/canvas-bridge-contract.md)。

```powershell
# 0) 前置：harness 源码在仓库同级目录 deepseek-harness/（不随本仓库提交）
#    首次/更新上游后：把 gaiZao 的插件注册进 harness
node gaiZao/scripts/install-velagent.ps1

# 1) 构建画布 embed（会清理全局 CSS 并复制到 harness 的 apps/web/public/）
cd gaiZao/features/velagent-ui
pnpm build:embed

# 2) 构建 harness 产物
cd ..\..\..\deepseek-harness
pnpm install --no-frozen-lockfile
$env:CI='1'; $env:DSH_CLIENT_COMMIT_HASH='0000000'; $env:DSH_CLIENT_TITLE='VelAgent'
pnpm build:artifacts

# 3) 启动（隔离数据目录，端口 2021；模型凭证复用 Harness 现有配置）
$env:DSH_HOME = "$env:APPDATA\Enrui\VelAgent\data\harness-home"
$env:DSH_AGENTS_HOME = "$env:DSH_HOME\agents"
node apps/cli/lib/bin.js --profile web --port 2021 --no-open
```

打开终端输出的带 token 的地址，点右上角 **VelAgent 电路** 或左下角 **⚡ VelAgent** 打开画布。

验收脚本（在 `VelAgent/` 下）：

```powershell
node gaiZao/scripts/verify-canvas-bridge.mjs http://127.0.0.1:2021
node gaiZao/scripts/verify-workspace-airun.mjs "http://127.0.0.1:2021/?token=<token>"
```

实际效果：Agent 在对话里调用 `velagent_read_circuit` / `velagent_place_component` /
`velagent_update_component`，右侧画布同步变化（LED 变蓝、新增面包板）；
「运行」页签的 **试运行** 会让 Agent 读取电路+代码并调用 `velagent_play_timeline` 播放预测的 LED/串口行为：

![Agent 操作画布](gaiZao/docs/debug-integration-03-agent.png)

## 运行（桌面版 · 备用形态）

前提：Node.js 18+、Rust 1.80+、MSVC 构建工具、Windows 自带 WebView2（Win10/11 默认有）。

```bash
# 1) 构建前端（桌面壳会内嵌 dist）
cd gaiZao/features/velagent-ui
npm install
npm run build

# 2) 运行桌面端（Rust + Tauri）
cd gaiZao/tauri
cargo run
```

开发模式（前端热更新）：

```bash
cd gaiZao/features/velagent-ui && npm run dev     # 终端 1：http://localhost:5173
cd gaiZao/features/velagent-ui && npm run desktop:dev   # 终端 2：Tauri 开发窗口（会自动起前端）
```

启动后，窗口右上角 **AI 控制台** 会显示本地控制面地址与令牌（`http://127.0.0.1:7317`）。

## 接入 AI harness（Claude Code / Cursor / 自研 agent）

两种方式，任选其一：

**1) HTTP 控制面**（任何能发 HTTP 的程序）

```bash
curl http://127.0.0.1:7317/health
curl -H "Authorization: Bearer <token>" http://127.0.0.1:7317/api/v1/state
curl http://127.0.0.1:7317/llms.txt        # 给 AI 的完整指南
```

**2) MCP（stdio）**

```bash
claude mcp add velagent -- "<安装路径>\VelAgent.exe" --mcp-stdio
```

可用工具：`velagent_state / catalog / place_board / place_component / connect / remove / validate / batch / highlight / undo`。

> **安全**：写操作默认关闭，需要在「AI 控制台」勾选 **允许 AI 修改画布**；令牌只存在本机。

## AI 运行（不用虚拟环境 / 不做仿真）

- 点工具栏 **▶ AI 运行**：把「电路 + 当前代码」发给 AI，返回行为剧本并播放成动画（LED / 串口 / 解释）；
- 没配置 AI 或调用失败时，自动降级为**本地规则预测**（解析 `digitalWrite` / `delay` / `Serial.println`），离线也能演示；
- AI 设置（**AI 设置** 按钮）：服务商预设 + Base URL + 模型 + API Key。Key 只存本机，不上传；支持本地 Ollama 完全离线。

## 运行（旧版前端，仅供参考）

```bash
cd gaiZao/features/velagent-ui
npm install      # 安装依赖（会自动复制 Monaco 静态资源）
npm run dev      # → http://localhost:5173/editor
npm run build    # 生产构建，产物在 gaiZao/features/velagent-ui/dist
```

环境：Node.js 18+（实测 24.16）、npm 10+。不需要 Python / Docker / arduino-cli。

## 功能范围

- **代码编辑器**：Monaco，多文件工作区、文件树、标签页、语法高亮（C/C++、Python、JSON、HTML、CSS、汇编）；
- **电路画布**：拖拽摆放板卡与元件、旋转、复制粘贴、连线、面包板吸附、撤销重做、缩放平移；
- **元件库**：154 个元件 + 30 块板卡，支持搜索与分类过滤；
- **中文界面**：默认简体中文，157 个元件中文名、30 块板卡中文名与简介、中文搜索，可切换 9 种语言；
- **本地文件**：导入/导出 `.vlx` 项目文件。

**没有**：编译、运行、烧录、串口、仿真、后端、账号。

## 界面布局（VelAgent 自有）

- **顶栏**：VelAgent 品牌 → 菜单 → 视图切换（代码 / 分栏 / 电路）→ AI 状态胶囊 → AI 运行 / 导出；
- **左侧活动栏**：文件树、AI 控制台、AI 设置、AI 运行、GitHub、使用说明；
- **右侧 AI 控制台 dock**：连接信息 / 令牌（可显示/隐藏）/ 写权限开关 / 画布变更事件流 / 接口速查；
- **底部状态栏**：AI 控制面地址与读写状态、板卡/元件/连线数量、版本与 AGPL 声明；
- **品牌色**：紫罗兰→青绿渐变（非上游蓝色），画布"添加"、AI 运行等主按钮使用品牌渐变。

## 界面截图

- Harness 深度集成（画布 dock + Agent 工具调用）：[docs/debug-integration-03-agent.png](gaiZao/docs/debug-integration-03-agent.png)
- 主界面：[docs/screenshot-overview.png](gaiZao/docs/screenshot-overview.png)
- AI 控制台 dock：[docs/screenshot-ai-console.png](gaiZao/docs/screenshot-ai-console.png)
- 元件库（154 个）：[docs/screenshot-components.png](gaiZao/docs/screenshot-components.png)

## 许可证与声明

VelAgent 由两个上游项目衍生/集成而来，**两套原始许可证与版权声明都随仓库分发**：

| 上游 | 角色 | 许可证 | 声明位置 |
| --- | --- | --- | --- |
| [Velxio](https://github.com/davidmonterocrespo24/velxio) | 电路画布 / 编辑器前端（衍生） | **AGPLv3**（另有商业许可） | [LICENSE_NOTICE/velxio/](LICENSE_NOTICE/velxio/) |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | AI 宿主 / Agent / Web GUI（集成） | **MIT** | [LICENSE_NOTICE/deepseekharness/](LICENSE_NOTICE/deepseekharness/) |

- 因 Velxio 为 AGPLv3，本仓库**整体以 AGPLv3 发布**：见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)；
- DeepSeek Harness 为 **MIT**：修改、再分发、商用均允许，但必须保留其版权与许可声明；
  对外分发安装包/构建产物时，请附带 [LICENSE_NOTICE/deepseekharness/](LICENSE_NOTICE/deepseekharness/)；
- 我们不对 DeepSeek Harness 增加额外限制，也不对 Velxio 衍生部分放宽 AGPLv3 义务；
- 第三方依赖与素材见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

上游项目：**Velxio** © 2025 David Montero Crespo（AGPLv3 / 商业双许可）·
**DeepSeek Harness** © 2026 DeepSeek（MIT）。
