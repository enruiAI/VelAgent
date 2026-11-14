# 上游项目：Velxio（原版信息）

本目录保存 **Velxio** 的原始开源许可证与版权声明。VelAgent 的前端代码是在 Velxio 前端基础之上
做了大量修改的衍生作品。

| 项目 | 信息 |
| --- | --- |
| 名称 | Velxio — Arduino & Embedded Board Emulator |
| 仓库 | https://github.com/davidmonterocrespo24/velxio |
| 作者 / 版权 | Copyright (C) 2025 David Montero Crespo |
| 许可证 | GNU Affero General Public License v3.0（AGPLv3），另提供商业许可（双许可） |
| 本仓库使用的快照 | `master` 分支，commit `c2d4ef37b50aebe4eaccd928a01f49b0b20b3eaa`（2026-11-11），下载于 2026-11-11 |
| 官方线上版 | https://velxio.dev |
| 许可证文件 | [LICENSE](LICENSE)（AGPLv3 全文，原样保存） |
| 商业许可说明 | [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md)（上游双许可说明，原样保存） |

## 原版项目里我们用到/保留的部分

- React + Vite + TypeScript 前端工程结构；
- Monaco 编辑器封装、多文件工作区（zustand store）；
- 电路画布：板卡/元件渲染、连线与拖拽、面包板吸附、元件属性面板、元件选择器；
- 元件与板卡的 SVG/PNG 素材、`components-metadata.json`、i18n 文案、主题样式。

## 原版项目里我们没有使用的部分（已在 VelAgent 中整体删除）

- 后端（FastAPI、arduino-cli / ESP-IDF 编译、QEMU 仿真桥、WebSocket、REST API）；
- 编译 / 运行 / 烧录 / 串口 / 示波器 / SPICE 电气仿真 / 自定义芯片；
- 示例库、账号与云项目、PRO 覆盖层、Tauri 桌面壳、营销 SEO 页面与测试。

> 完整的改动清单见仓库根目录 [NOTICE.md](../../NOTICE.md)。
> 任何再分发都必须保留本目录（或等效的上游许可证与版权声明）。
