# features —— 功能层

每个功能一个目录、一个独立开关；UI 功能打成 **bundle**（`package.json` 含 `dsh.bundle` + `dsh.client`，
Node 半区 `index.js` + 浏览器半区 `client.js`），用 `dsh plugin --profile web add ./gaiZao/features/<id>` 安装。

| 功能 | 目录 | 状态 | 说明 |
| --- | --- | --- | --- |
| 核心工作台插件 | `features/velagent-workbench/` | active | 宿主桥（CanvasHub / 路由 / `velagent_*` 工具 / UI 资产路由）+ 右侧工作台 dock |
| Velxio 改写前端 | `features/velagent-ui/` | active | 画布 + Monaco + 元件库；构建成 embed 资产，由 workbench 宿主路由发出 |
| VelAgent 品牌层 | `features/velagent-brand/` | active | 侧边栏产品名 / 图标 / favicon（官方槽位） |
| 独立桌面壳 | `features/velagent-desktop/` | 备用 | Tauri 2 桌面端（没有 Harness 时的形态） |

构建：`node gaiZao/scripts/build-features.mjs`（全部）或 `node gaiZao/scripts/build-features.mjs velagent-workbench`（单个）。

命名：kebab-case 英文；一个功能超过 5 个源文件或有多个独立能力时拆成两个目录。
