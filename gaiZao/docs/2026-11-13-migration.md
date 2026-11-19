# 2026-11-13 架构迁移：fork + bundle 插件

## 目标

VelAgent 改为官方 DeepSeek Harness 的 **fork**（底座只读），全部改造收进 `gaiZao/`，
以 **bundle 插件** 挂载，官方源码零改动（除登记的 2 条补丁）。

## 结果

| 项目 | 之前 | 现在 |
| --- | --- | --- |
| 仓库 | 只装自定义代码；上游 `deepseek-harness/` 同级目录 | 官方 fork：`master` = 官方镜像基线（e8f7b93a），`dev` = 工作分支（完整历史），`main` = dev 的单提交快照（默认分支，展示用） |
| 插件 | 源码复制进 `packages/client/ui-velagent` + 改 3 个注册文件 | `gaiZao/features/velagent-workbench` bundle（index.js/client.js），`dsh plugin --profile web add` 安装 |
| UI 资产 | 复制进 `apps/web/public` | 插件宿主 `webServer` 路由从 `features/velagent-ui/embed-dist` 发出 |
| 品牌 | 散改官方 locale / primitives | `features/velagent-brand` bundle（官方槽位） |
| 启动 | `start.cmd` / `start.ps1` | 全局 `velagent` 命令（`install-velagent.ps1` 安装）+ `start.ps1` 备用 |
| 越界改动 | 未登记 | `patches/PATCHES.md` 2 条（0001 LICENSE AGPL、0002 README 介绍），`check-upstream-changes.ps1` 机检 |
| 许可证 | 根 AGPL，上游许可在 LICENSE_NOTICE | 根 AGPL（补丁 0001），上游 MIT 全文保留 `gaiZao/licenses/deepseekharness/` |

## 关键文件

- 插件：`features/velagent-workbench/src/{index.ts,client/}` → `index.js` / `client.js`
- 资产路由：`features/velagent-workbench/src/index.ts`（`/velagent-assets`、`/components-metadata.json`、
  `/component-svgs`、`/components`、`/boards`、`/fonts`）
- Velxio 前端：`features/velagent-ui/`（`pnpm build:embed` → `embed-dist/`）
- 品牌：`features/velagent-brand/`
- 构建：`scripts/build-features.mjs`
- 安装/启动：`scripts/install-velagent.ps1` + `scripts/launch-core.mjs`
- 同步/机检：`scripts/sync-upstream.ps1`、`scripts/check-upstream-changes.ps1`

## 验证（2026-11-13）

- 官方底座 `pnpm build`：10/10 gates passed；
- `verify-canvas-bridge.mjs`：ALL CHECKS PASSED（含 `/velagent-assets/*`、`/components-metadata.json` 路由）；
- headless E2E：dock 打开、画布/代码/JSON/工作区渲染、品牌标题与 favicon = VelAgent、无控制台错误；
- 真实 AI 回合（6 步）：U1/R1/D1 放置 + 3 根线 + validate 0/0 + 读取电路 JSON；
- 全局启动器：`velagent` 命令正确识别运行中实例并输出当前 token URL。

## 待办

- 推送 `dev` / `master` 并把 `main` 切到新历史（等待 GitHub 网络恢复）；
- 旧 `deepseek-harness/` 同级目录可在确认不再需要后删除（当前产品已从仓库根构建）。
