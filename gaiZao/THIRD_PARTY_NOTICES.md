# THIRD_PARTY_NOTICES — 第三方依赖与素材

本仓库**不提交** `node_modules/`（安装时由 npm 拉取），也不提交仓库同级的 `deepseek-harness/`
源码副本。以下是运行时依赖、构建工具与静态素材的许可证清单（以各项目仓库/包内 LICENSE 原文为准）。

## 两个上游项目

VelAgent 由两个开源上游项目衍生/集成而来，它们的**原版许可证与版权声明随仓库一起分发**：

| 项目 | 角色 | 许可证 | 声明位置 |
| --- | --- | --- | --- |
| [Velxio](https://github.com/davidmonterocrespo24/velxio) | 电路画布 / 编辑器前端（衍生） | AGPLv3（另有商业许可） | [LICENSE_NOTICE/velxio/](LICENSE_NOTICE/velxio/) |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | AI 宿主 / Agent / Web GUI（集成） | MIT | [LICENSE_NOTICE/deepseekharness/](LICENSE_NOTICE/deepseekharness/) |

> **MIT 义务**：DeepSeek Harness 以 MIT 发布，要求所有副本或实质性部分保留版权声明与许可声明。
> 对外分发安装包/构建产物时，必须附带 `LICENSE_NOTICE/deepseekharness/`（或等效声明）。

### DeepSeek Harness 的第三方依赖

DeepSeek Harness 自身带有完整的第三方依赖与素材声明，原样保存在
[`LICENSE_NOTICE/deepseekharness/THIRD_PARTY_NOTICES.md`](LICENSE_NOTICE/deepseekharness/THIRD_PARTY_NOTICES.md)。
分发 VelAgent 时该文件同样必须保留。

## VelAgent 前端（Velxio 衍生）的 npm 依赖

| 包 | 许可证 |
| --- | --- |
| react / react-dom | MIT |
| react-router-dom | MIT |
| @monaco-editor/react | MIT |
| monaco-editor | MIT |
| @wokwi/elements | MIT |
| zustand | MIT |
| i18next / react-i18next / i18next-browser-languagedetector | MIT |
| lucide-react | ISC |
| idb-keyval | Apache-2.0 |
| jszip | MIT 或 GPL-3.0-or-later（双许可，本项目按 MIT 使用） |
| @tauri-apps/api / @tauri-apps/cli | MIT / Apache-2.0 |
| vite / @vitejs/plugin-react | MIT |
| typescript | Apache-2.0 |
| @types/* | MIT |

## 静态素材

| 素材 | 来源 | 说明 |
| --- | --- | --- |
| 板卡插图（`VelAgent/gaiZao/chajian/velxio-ui/public/boards/`，同时被复制进 Harness 的 `apps/web/public/boards/`） | 随 Velxio 分发的板卡素材，上游致谢 [wokwi-boards](https://github.com/wokwi/wokwi-boards) | 作为 Velxio（AGPLv3）发行包的一部分复用；素材原始仓库见上游致谢 |
| 元件 SVG（`component-svgs/`、`components/`） | 上游致谢 [wokwi-elements](https://github.com/wokwi/wokwi-elements) | wokwi-elements 使用 MIT |
| 字体 `Inter.var.woff2` | Inter 字体项目 | SIL Open Font License 1.1 |
| 字体 `JetBrainsMono.var.woff2` | JetBrains Mono 字体项目 | SIL Open Font License 1.1 |
| `components-metadata.json` | 由 Velxio 的元数据生成脚本产出 | 随 Velxio 分发，见上游 LICENSE_NOTICE |

> 若你计划商用或再分发，请逐一核对上表项目的许可原文；上游 Velxio 的完整许可证保存于
> `LICENSE_NOTICE/velxio/`，DeepSeek Harness 的完整许可证与第三方声明保存于
> `LICENSE_NOTICE/deepseekharness/`。
