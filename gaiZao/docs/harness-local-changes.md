# 对 DeepSeek Harness 的本地改动清单

换上游（重新拉取/替换 `deepseek-harness/`）后，按本清单把 VelAgent 需要的改动重新应用。
其中**插件包与注册**已由 `gaiZao/scripts/install-velagent.ps1` 自动完成；
**品牌化 / 实例隔离**目前需要手工对照（上游若已包含相同改动则跳过）。

> 本文件是 `deepseek-harness/LOCAL_VELAGENT_CHANGES.md` 的迁移版；换上游后以本文件为准。

> 上游是 MIT 许可：本目录的修改不改变原许可义务，版权与许可声明见
> `../../LICENSE_NOTICE/deepseekharness/`（LICENSE / NOTICE.md / THIRD_PARTY_NOTICES.md）。

## 一、本机实例隔离（最小改动）

| 项目 | 原值 | 改为 | 原因 |
| --- | --- | --- | --- |
| 用户数据目录（`DSH_HOME` 默认值） | `~/.dsh` | `~/.velagent` | 会话记忆与官方实例隔离 |
| 共享 Agent 配置目录（`DSH_AGENTS_HOME` 默认值） | `~/.agents` | `~/.velagent-agents` | 不读官方实例的 agent 配置 |
| Web UI 默认端口 | `3080` | `2021` | 避开官方实例端口，派生端口从 2022 起 |
| Web Worker 运行时默认端口 | `3080` | `2022` | 不与主端口冲突 |

涉及文件：

- `packages/util/home-paths/src/index.ts`
- `packages/bundle/web-app/cordis.patch.yml`
- `packages/experimental/webworker-runtime/src/worker-host.ts`
- `packages/boot/cmdline/src/index.ts`（示例注释）

运行时仍可用 `DSH_HOME` / `DSH_AGENTS_HOME` / `--port` 覆盖这些默认值。

## 二、品牌化（VelAgent）

- 浏览器标题由 `DSH_CLIENT_TITLE` 提供（默认 VelAgent 构建时注入）；
- `packages/client/ui-primitives`：`BrandWordmark` / `FishLogo` 换成 VelAgent 字标与芯片图标；
- `packages/client/ui-brand-official`：允许非 official 配置也显示品牌视觉；
- `packages/client/*` 各 locale 文件里的产品名、欢迎语、引导文案替换为 VelAgent；
  **DeepSeek 模型名、服务商名、登录流程保持原样**（它们指向真实上游服务）。

## 三、内置插件 `ui-velagent`（电路画布原生集成）

新增包 `packages/client/ui-velagent`（MIT），让 VelAgent 电路画布成为 Harness 的原生能力：

**宿主半边（`src/index.ts`）**

- `CanvasHub`：按会话保存浏览器推送的画布快照（boards / components / wires）、命令队列、
  长轮询 waiter、ack 承接；15s 无推送视为断线；
- 注册 5 条同源 HTTP 路由（走 Harness 自己的 web server，不额外开端口、无 token）：
  `POST /velagent/canvas/snapshot`、`POST /velagent/canvas/ack`、
  `GET /velagent/canvas/ops`（长轮询）、`GET /velagent/canvas/state`、`GET /velagent/canvas/health`；
- 注册 14 个全局 Cordis 工具：`velagent_read_circuit`、`velagent_place_board`、
  `velagent_place_component`、`velagent_update_component`、`velagent_remove_component`、
  `velagent_connect`、`velagent_remove_wire`、`velagent_validate`、`velagent_highlight`、
  `velagent_clear`，以及代码/试运行工具 `velagent_read_code`、`velagent_write_code`、
  `velagent_play_timeline`、`velagent_stop_timeline`；
- 注册 system prompt 段落 `velagent:circuit-canvas`（模型知道画布存在、先读后改、未连接时提示用户）。

**浏览器半边（`src/client/`）**

- 右侧可伸缩 dock（header 按钮 / sidebar footer 按钮打开），宽 360px–72vw，可收起；
- `canvasSync.ts`：动态加载 `/velagent-assets/velxio-ui.css` 与 `/velagent-assets/velagent-embed.js`，原生 mount 画布，
  状态变化 120ms 去抖后 POST 快照，长轮询取命令 → `executeCommand` → ack 回传；
- 连接状态（已连接/连接中/未连接/错误）、主题 token、localStorage 记住宽度与展开状态。

**注册位置**

- `packages/bundle/web-app/cordis.patch.yml`：`ui-velagent` 行；
- `packages/bundle/web-app/package.json`：`@deepseek-ai/dsh-client-ui-velagent` 依赖；
- `tsconfig.base.json`（paths 已有自动生成）、`tsconfig.client.json`（项目引用）、
  `packages/client/ui-velagent/tsconfig.json`（host 面需要 node types + core/tools + core/system-prompt + host/webserver 引用）。

**画布资产（同源静态文件）**

- `features/velagent-ui/embed-dist/`：`velagent-embed.js`、`velxio-ui.css`、`components-metadata.json`、
  `boards/`、`component-svgs/`、`components/`、`fonts/`、`monaco/`；
- 由 `features/velagent-workbench` 宿主的路由发出（`/velagent-assets/*`、`/components-metadata.json`、
  `/component-svgs`、`/components`、`/boards`、`/fonts`），**不再复制进 `apps/web/public`**（协议见
  `gaiZao/docs/canvas-bridge-contract.md`）。

## 四、构建与运行

```powershell
# 1) 安装依赖（改过 package.json 后需要）
pnpm install --no-frozen-lockfile

# 2) 构建全部产物（含 client bundle、Web dist、public 资产）
$env:CI='1'; $env:DSH_CLIENT_COMMIT_HASH='0000000'; $env:DSH_CLIENT_TITLE='VelAgent'
pnpm build:artifacts

# 3) 启动（isolated home 目录，端口 2021）
$env:DSH_HOME = "$env:APPDATA\Enrui\VelAgent\data\harness-home"
$env:DSH_AGENTS_HOME = "$env:DSH_HOME\agents"
node apps/cli/lib/bin.js --profile web --port 2021 --no-open
```

插件单测：`pnpm exec vitest run packages/client/ui-velagent/tests/canvas-hub.host.spec.ts`。

单应用启动：VelAgent 仓库里的 `start.cmd` / `start.ps1` 只启动这一个 Harness 进程（端口 2021），
若端口已在监听则只打开页面；画布/代码/运行都在同一个页面里，不再需要第二个服务或窗口。

## 五、其他说明

- 源码副本不含 `.git`，构建必须提供 `DSH_CLIENT_COMMIT_HASH`；
- 内网镜像无法获取 `cdn.sheetjs.com` 的 `xlsx`，本地安装用 `@e965/xlsx` 别名；
- 未使用 CLI 自带账号/登录：本地验证时可把官方实例的 `DEEPSEEK_API_KEY` 以环境变量注入，
  插件本身不读取、不保存任何模型凭证；
- 本目录不随 VelAgent git 仓库提交；分发构建产物时需附带 `VelAgent/LICENSE_NOTICE/deepseekharness/`。
