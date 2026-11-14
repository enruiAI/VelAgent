# NOTICE — 上游项目声明与改动说明

**VelAgent** 由两部分组成，分别来自两个开源上游项目，并在它们之上做了**大量修改**：

| # | 上游项目 | 角色 | 许可证 |
| --- | --- | --- | --- |
| 1 | **Velxio** — Arduino & Embedded Board Emulator | 电路画布 / 编辑器前端 | **AGPLv3**（另提供商业许可） |
| 2 | **DeepSeek Harness** — all-plugin Cordis agent harness | AI 宿主 / Agent / Web GUI | **MIT** |

## 一、上游项目：Velxio

| 项目 | 信息 |
| --- | --- |
| 名称 | **Velxio** — Arduino & Embedded Board Emulator |
| 仓库 | <https://github.com/davidmonterocrespo24/velxio> |
| 作者 / 版权 | **Copyright (C) 2025 David Montero Crespo** |
| 许可证 | **GNU Affero General Public License v3.0（AGPLv3）**，另提供商业许可（双许可） |
| 使用的快照 | master 分支，commit c2d4ef37b50aebe4eaccd928a01f49b0b20b3eaa（2026-11-11） |
| 官方线上版 | <https://velxio.dev> |

### 原版开源协议在哪里

**上游原始许可证全文与版权声明完整保存在本仓库的 `LICENSE_NOTICE/velxio/` 目录下：**

- `LICENSE_NOTICE/velxio/LICENSE` —— 原版 AGPLv3 许可证全文（原样保存，未改动）；
- `LICENSE_NOTICE/velxio/COMMERCIAL_LICENSE.md` —— 原版双许可中的商业许可说明；
- `LICENSE_NOTICE/velxio/NOTICE.md` —— 上游项目信息、使用的快照、复用/删除范围。

### 我们对原版做了哪些改动（大量修改）

**保留并改写（前端界面部分）**

- 保留 React + Vite + TypeScript 工程骨架，重构入口与路由（只保留编辑器与图片转 C 数组工具）；
- 保留 Monaco 编辑器、多文件工作区、文件树与标签页；
- 保留电路画布（板卡/元件渲染、拖拽、旋转、连线、面包板吸附、撤销重做、缩放平移）；
- 保留元件选择器与 154 个元件 / 30 块板卡的可视化素材；
- **新增**整套简体中文本地化：界面文案、元件分类、157 个元件中文名、约 60 个常用元件中文简介、
  30 块板卡中文名与简介、中文搜索、语言切换器（默认中文）。

**整体删除（原版的后端与仿真能力）**

- 后端服务（FastAPI、arduino-cli / ESP-IDF 编译、QEMU 仿真桥、WebSocket、REST API）；
- 编译 / 运行 / 烧录 / 串口监视器 / 示波器 / SPICE 电气仿真 / 自定义芯片；
- 示例库、账号与云项目、PRO 覆盖层、Tauri 桌面壳、营销 SEO 页面、单元测试。

**规模变化**：src 由约 **865 个文件 / 22.6 万行** 精简为约 **181 个文件 / 3.7 万行**。

## 二、上游项目：DeepSeek Harness

| 项目 | 信息 |
| --- | --- |
| 名称 | **DeepSeek Harness** — all-plugin Cordis agent harness |
| 仓库 | <https://github.com/deepseek-ai/deepseek-harness> |
| 作者 / 版权 | **Copyright (c) 2026 DeepSeek** |
| 许可证 | **MIT License** |
| 使用的版本 | `0.2.2-rc.2`，master 分支源码快照（2026-11-12），位于仓库同级目录 `deepseek-harness/` |

### 原版开源协议在哪里

**上游 MIT 许可证全文、版权声明与第三方依赖声明保存在 `LICENSE_NOTICE/deepseekharness/` 目录下：**

- `LICENSE_NOTICE/deepseekharness/LICENSE` —— 原版 MIT 许可证全文（原样保存，未改动）；
- `LICENSE_NOTICE/deepseekharness/NOTICE.md` —— 上游项目信息、使用的版本/快照、复用与修改说明；
- `LICENSE_NOTICE/deepseekharness/THIRD_PARTY_NOTICES.md` —— 上游第三方依赖与素材声明（原样保存）。

### 我们对原版做了哪些改动（大量修改）

- **实例隔离**：用户数据目录 `~/.dsh` → `~/.velagent`，共享 Agent 配置目录 `~/.agents` →
  `~/.velagent-agents`，Web 默认端口 `3080` → `2021`（Worker 运行时 `2022`）；
- **品牌化**：浏览器标题、侧栏品牌字标与图标、首页品牌视觉、设置/引导页文案替换为 VelAgent；
  保留模型名、服务商名与登录流程中的 DeepSeek 名称（指向真实上游服务，不应替换）；
- **新增内置插件 `ui-velagent`**：宿主半边提供画布状态中心、同源 HTTP 路由与 `velagent_*` 工具；
  浏览器半边在 Harness 右侧原生挂载 VelAgent 电路画布（不是 iframe、不是独立窗口），并实时同步画布状态；
- **构建适配**：本地构建需要 `DSH_CLIENT_COMMIT_HASH`（源码副本不含 `.git`）；本地安装对 `xlsx`
  依赖使用 `@e965/xlsx` 别名（内网镜像限制，仅影响本地构建）。

完整改动清单见仓库同级 `deepseek-harness/LOCAL_VELAGENT_CHANGES.md`。

> `deepseek-harness/` 是仓库同级目录，不随本 git 仓库提交；对外分发 VelAgent 安装包/构建产物时，
> 必须把 `LICENSE_NOTICE/deepseekharness/` 一起附带（MIT 义务）。

## 本仓库的许可证

| 部分 | 许可证 |
| --- | --- |
| VelAgent 自有代码 + Velxio 衍生前端 | **AGPLv3**（见根目录 `LICENSE`） |
| DeepSeek Harness 源码/构建产物（含我们的修改） | **MIT**（见 `LICENSE_NOTICE/deepseekharness/LICENSE`） |

由于上游 Velxio 为 AGPLv3（强 copyleft），本仓库作为其衍生作品整体继续以 **AGPLv3** 发布。
MIT 与 AGPLv3 兼容：把 MIT 部分与 AGPLv3 部分作为同一产品分发是允许的，前提是**两类声明都保留**：

- Velxio 衍生部分：任何分发、修改或作为网络服务提供时，必须继续以 AGPLv3 提供对应源码，
  并保留 `LICENSE_NOTICE/` 目录中的上游许可证与版权声明；
- DeepSeek Harness 部分：保留 MIT 版权与许可声明（`LICENSE_NOTICE/deepseekharness/`），
  我们不对其增加额外限制；修改后的 Harness 源码同样可获取。

第三方依赖与素材的许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
