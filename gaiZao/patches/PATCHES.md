# PATCHES.md —— 越界补丁总清单

每条补丁必须写清：**改了什么文件、为什么官方扩展点做不到、什么时候决定改、官方更新后如何重放。**

| # | 补丁文件 | 影响的上游文件 | 改了什么 | 为什么 | 决策时间 | 重放方式 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0001 | `0001-root-license-agpl.diff` | `LICENSE` | 根许可证由 MIT 换成 AGPLv3（上游 MIT 全文保留在 `gaiZao/licenses/deepseekharness/`） | VelAgent 整体包含 Velxio AGPL 衍生代码（`features/velagent-ui`），整体分发必须按 AGPLv3；MIT 部分保留原声明 | 2026-11-13 13:10 | `git checkout master -- LICENSE`，再用 `gaiZao/licenses/AGPL-3.0.txt` 覆盖；MIT 副本不要动 | active |
| 0002 | `0002-readme-velagent-intro.diff` | `README.md` | 顶部插入 VelAgent 项目介绍块（定位 / 启动 / 目录 / 许可证），原官方 README 正文保持在后 | GitHub 首页需要展示本 fork 的实际项目与启动方式，官方 README 没有覆盖机制；`gaiZao/` 的文档不会出现在仓库首页 | 2026-11-13 13:35 | `git checkout master -- README.md` 后把 `gaiZao/patches/0002-readme-velagent-intro.diff` 重新 `git apply` | active |
| 0003 | `0003-disable-dependabot.diff` | `.github/dependabot.yml` | 删除上游继承的 Dependabot 配置 | fork 仓库不需要上游的自动依赖升级：会持续创建 `dependabot/*` 分支与 PR 噪音；本仓库依赖由 `pnpm-lock.yaml` 固定，升级走 sync-upstream 统一处理 | 2026-11-14 09:45 | `git checkout master -- .github/dependabot.yml` 后再删除并重新生成 diff；也可在 GitHub 设置里关闭 Dependabot | active |
| 0004 | `0004-desktop-velagent-brand.diff` | `apps/desktop/**`（electron-builder 配置、src 本地化/主进程、installer 字符串、打包/烟测脚本） | 产品名改为 **VelAgent**，图标换成渐变 V，内置 VelAgent 插件（workbench/brand）与 embed 资产、默认桌面 profile 带上 VelAgent bundles、OS 协议/CLI/数据目录改为 VelAgent 专用：安装器/快捷方式/窗口标题/关于信息统一品牌；修正烟测脚本硬编码的旧 exe 名 | 官方 Desktop 打包没有产品名覆盖机制（productName 与安装器字符串均硬编码）；fork 需要自己的应用名 | 2026-11-18 17:20 | 上游更新后重新 `git apply`；重跑 `pnpm run package:desktop:win:x64:unsigned` 验证 | active |
| 0005 | `0005-velagent-data-home.diff` | `packages/util/home-paths/src/index.ts` | 默认数据根目录由 `~/.dsh` 改为 `~/.velagent` | 产品与官方 DeepSeek Harness 同时安装时必须各自独立保存会话/设置/凭据，否则会互相覆盖；官方没有可配置默认目录的入口（只有 DSH_HOME 环境变量） | 2026-11-19 10:20 | `git checkout master -- packages/util/home-paths/src/index.ts` 后重放 diff；桌面端同时强制注入 DSH_HOME | active |
| 0006 | `0006-velagent-skip-onboarding.diff` | `packages/client/ui-settings-account/src/client/{onboarding-state,DesktopOnboardingEntry}.ts*` | 首次启动的欢迎 / 额度 / 用途向导永不显示 | VelAgent 是独立产品，已移除登录与向导；官方 onboarding 只在桌面登录后出现，必须从源码关掉，否则新用户每次安装都会先被引导页覆盖 | 2026-11-19 17:20 | `git checkout master -- packages/client/ui-settings-account/src/client/onboarding-state.ts packages/client/ui-settings-account/src/client/DesktopOnboardingEntry.tsx` 后重放 diff | active |

## 不需要越界的部分（对照用）

- **插件**：`features/velagent-workbench` / `features/velagent-brand` 以 **bundle** 形态存在，用
  `dsh plugin --profile web add <目录>` 安装进 profile；不改 `packages/`、不改 `cordis.patch.yml`、
  不改 `tsconfig.client.json`、不复制资产到 `apps/web/public`。
- **UI 资产**：`features/velagent-ui/embed-dist` 由插件宿主的 `webServer` 前缀路由发出
  （`/velagent-assets`、`/components-metadata.json`、`/component-svgs`、`/components`、`/boards`、`/fonts`）。
- 如未来确实需要改官方文件，按 `gaiZao/AGENTS.md` 第 3 节流程登记。
