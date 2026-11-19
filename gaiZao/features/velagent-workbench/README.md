# velagent-workbench —— Harness 内置工作台插件（bundle）

把 VelAgent 的电路画布 / 代码编辑器 / 工作区文件树原生嵌进 Harness。

- **Node 半区 `index.js`**：CanvasHub（按会话保存画布快照 + 命令队列 + 长轮询）、
  `/velagent/canvas/*` 与 `/velagent/workspace/*` 路由、`velagent_*` 工具、system prompt 段落，
  以及 **UI 静态资产路由**（`/velagent-assets/*`、`/components-metadata.json`、`/component-svgs`、
  `/components`、`/boards`、`/fonts`，从 `../velagent-ui/embed-dist` 读取）；
- **浏览器半区 `client.js`**：官方动态客户端模块（`window.__ModuleLoader__.load`），
  注册会话头部动作与侧栏底部动作，挂载右侧 dock；
- **bundle 清单**：`package.json` 的 `dsh.bundle.patch` + `dsh.client`；`cordis.patch.yml` 插入
  `velagent-workbench` 行。

## 构建

```powershell
node gaiZao/scripts/build-features.mjs velagent-workbench
```

## 安装

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/install-velagent.ps1
```

（等价于 `node apps/cli/lib/bin.js plugin --profile web add <本目录>`。）

## 资产

UI 资产来自 `features/velagent-ui` 的 `pnpm build:embed` 输出（`embed-dist/`，gitignore）。
宿主通过 `webServer.register({kind:'prefix'})` 发出，不复制进 `apps/web/public`。
