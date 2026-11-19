# 上游项目：DeepSeek Harness（本目录保存原版 MIT 许可与版权声明）

本目录保存 **DeepSeek Harness** 的原始开源许可证、版权声明与第三方依赖声明。
VelAgent 的 AI 宿主部分（会话、Agent 循环、工具系统、Web GUI、模型接入）来自该项目，
我们以源码副本的方式集成，并做了大量修改（见下文与 `LOCAL_VELAGENT_CHANGES.md`）。

| 项目 | 信息 |
| --- | --- |
| 名称 | **DeepSeek Harness** — all-plugin Cordis agent harness |
| 仓库 | <https://github.com/deepseek-ai/deepseek-harness> |
| 作者 / 版权 | **Copyright (c) 2026 DeepSeek** |
| 许可证 | **MIT License**（宽松许可，允许修改、再分发、商用，要求保留版权与许可声明） |
| 使用的版本 | `0.2.2-rc.2`（`deepseek-harness/package.json`） |
| 使用的快照 | `master` 分支源码压缩包，解压于仓库同级目录 `deepseek-harness/`（2026-11-12） |
| 许可证文件 | [LICENSE](LICENSE)（上游 MIT 全文，原样保存，未做任何修改） |
| 第三方声明 | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)（上游第三方依赖与素材声明，原样保存） |

## 我们使用了哪些部分

- **Agent 运行时**：Agent 循环、Session 持久化、工具注册与执行、能力（skill）、子 Agent、后台任务、
  审批、上下文压缩、模型接入与凭证管理；
- **Cordis 插件框架**：插件加载、Slot 扩展点、服务注入、配置层（`cordis.patch.yml`）；
- **Web 宿主与浏览器客户端**：`apps/web`、`packages/client/*`（会话、聊天、侧栏、设置、主题、i18n 等
  全部 GUI 插件）、`packages/host/webserver`、Typert Remote 传输；
- **构建与启动链**：`pnpm` 工作区、`scripts/build.ts` 产物构建、`apps/cli` 启动器。

## 我们做了哪些修改（大量修改）

**1. 本机实例隔离（避免与官方 DeepSeek Harness 实例相互影响）**

- 用户数据目录默认值 `~/.dsh` → `~/.velagent`；
- 共享 Agent 配置目录默认值 `~/.agents` → `~/.velagent-agents`；
- Web UI 默认端口 `3080` → `2021`，Web Worker 运行时默认端口 `3080` → `2022`。

**2. 品牌化（VelAgent 自有品牌）**

- 浏览器标题、侧栏品牌字标与图标、首页品牌视觉、设置页与引导页文案替换为 VelAgent；
- 保留模型名、服务商名与登录流程中的 DeepSeek 名称（它们指向真实的上游服务，不应被替换）。

**3. VelAgent 电路画布原生插件（新增）**

- 新增包 `packages/client/ui-velagent`：宿主半边（画布状态中心、同源 HTTP 路由、`velagent_*` 工具）
  + 浏览器半边（右侧可伸缩 dock、原生挂载电路画布、实时状态同步）；
- 注册进 `packages/bundle/web-app/cordis.patch.yml` 与对应 `package.json` 依赖；
- 画布前端来自 `VelAgent/gaiZao/chajian/velxio-ui`（Velxio 衍生，见 `LICENSE_NOTICE/velxio/`），以 IIFE 产物
  `/velagent-embed.js` 形式被插件原生加载（不是 iframe、不是独立窗口）。

**4. 构建环境适配**

- 本地构建需要 `DSH_CLIENT_COMMIT_HASH`（源码副本不含 `.git`）；
- 因内网镜像无法获取 `cdn.sheetjs.com` 的 `xlsx` 包，本地安装改用 `@e965/xlsx` 别名（仅影响本地构建依赖）。

完整的改动文件清单见仓库同级 `deepseek-harness/LOCAL_VELAGENT_CHANGES.md`，
以及各修改文件内保留的注释。

## MIT 许可证义务

上游 MIT 许可只要求一件事：**在所有副本或实质性部分中保留版权声明与许可声明**。
因此：

- 本目录下的 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) **必须原样保留**，
  不得删除、改写或替换；
- 分发 VelAgent（安装包、构建产物、镜像）时，必须同时附带本目录（或等效的 MIT 版权与许可声明）；
- 修改过的 DeepSeek Harness 源码/构建产物仍受 MIT 保护，**我们不对其增加额外限制**。

## 与 VelAgent 整体 AGPLv3 的关系

VelAgent 的另一部分（电路画布与编辑器前端）是 **Velxio（AGPLv3）** 的衍生作品，受强 copyleft 约束，
因此仓库整体以 **AGPLv3** 发布（见根目录 `LICENSE`）。MIT 与 AGPLv3 兼容，
将 MIT 部分与 AGPLv3 部分作为同一产品分发是允许的，前提是**两类声明都保留**：

- Velxio 衍生部分：按 AGPLv3 提供对应源码；
- DeepSeek Harness 部分：保留 MIT 版权与许可声明（本目录），修改后的 Harness 源码同样可获取；
- 上游商业许可（Velxio 双许可）不适用于 DeepSeek Harness。

> 注意：`deepseek-harness/` 是**仓库同级目录**，不随 VelAgent 的 git 仓库提交；
> 若对外分发二进制或安装包，请把本目录（`LICENSE_NOTICE/deepseekharness/`）一起附上。

## 商标说明

"DeepSeek"、"DeepSeek Harness" 是深度求索（DeepSeek）的商标/项目名。VelAgent 是独立产品，
与 DeepSeek 官方无隶属或背书关系；产品界面中的 VelAgent 品牌替换仅用于区分本产品，
模型调用与登录仍指向 DeepSeek 官方服务。
