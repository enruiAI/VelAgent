> **历史/背景文档**：部分内容描述迁移前的架构（Tauri 主导、资产复制进 public 等）。
> 当前架构以 [gaiZao/README.md](../README.md) 与 [2026-11-13-migration.md](./2026-11-13-migration.md) 为准。

# Roadmap

> 架构：Tauri 2 桌面壳 + Rust 后端（本地控制面 / MCP / AI 网关）+ 复用上游 React 前端（154 元件 / 30 板卡）。
> 当前进度：M0–M3 已完成，M4 打包待做。

## M0 · 工程骨架 ✅

- [x] Tauri 2 工程（`gaiZao/tauri/`：Rust 后端 + 配置 + Token + 本地控制面）
- [x] 前端复用 + 中文界面 + 154 元件 / 30 板卡
- [x] 画布状态 → Rust 镜像（Tauri IPC）
- [x] AI 控制台面板（地址 / Token / 复制 / 只读开关 / 轮换）

## M1 · 控制面写操作 + 接线校验 ✅

- [x] 写端点：`POST/PATCH/DELETE /boards|components|wires`、`/batch`、`/validate`、`/highlight`、`/view`、`/undo`、`/redo`
- [x] 指令桥：Rust → Tauri event → 前端 store 执行 → 回传最新状态 + revision
- [x] 原子批量（失败自动回滚，一次撤销）
- [x] 校验器 9 条规则（缺电阻 / LED 反接 / 未共地 / 短路 / GPIO 接 GND / 引脚并联 / 未接线 …）
- [x] 审计日志、只读开关、Token 轮换
- [x] SSE `/api/v1/events`
- **验收已通过**：curl 从零放板卡 / 放 LED / 连线 / 校验出 `MISSING_RESISTOR` / 批量失败回滚 / 只读 403。

## M2 · MCP 适配 ✅

- [x] `velagent.exe --mcp-stdio`：initialize / tools/list / tools/call
- [x] 工具：state、catalog、place_board、place_component、connect、remove、validate、batch、highlight、undo
- [x] 通过本机控制面转发（复用同一套权限与校验）
- **验收已通过**：MCP 客户端可读状态、查真实 catalog、放板卡、跑校验。

## M3 · AI 运行预测 + 设置 ✅

- [x] AI 设置页：服务商预设（DeepSeek / OpenAI 兼容 / Kimi / 通义 / 本地 Ollama / 自定义）、Base URL、模型、Key
- [x] Rust AI 网关（OpenAI 兼容 `/chat/completions`），严格 JSON 剧本校验
- [x] `POST /api/v1/run/preview`（harness 也能触发）
- [x] 前端播放器：时间轴驱动 LED / 串口输出 / 解释 / 警告面板
- [x] 规则兜底：未配置 Key 或调用失败时，本地解析 `digitalWrite` + `delay` + `Serial.println` 演示
- **验收已通过**：浏览器模式点「▶ AI 运行」出现规则预测面板；HTTP `/run/preview` 未配置时返回明确错误。

## M3.5 · VelAgent 自有界面（已完成）

- [x] 品牌：VelAgent 字标 + 芯片图标 + 紫罗兰→青绿渐变主题色
- [x] 布局：左侧竖向活动栏 + 底部状态栏 + 右侧 AI 控制台 dock（不再用浮动遮罩盖住画布）
- [x] AI 控制台：地址/令牌（可显示隐藏/复制）、令牌轮换、AI 写权限开关、画布变更事件流、接口速查
- [x] 画布内品牌化：渐变"添加"按钮、板卡下拉与状态胶囊
- [x] 帮助菜单明确标注“上游项目 Velxio（AGPLv3）”，许可证声明继续保留

## M4 · 打包发布（待做）

- [ ] Windows 安装包（Tauri bundler；需要 NSIS/WiX 联网下载，国内可能需镜像）
- [ ] 素材裁剪（去掉未用到的板卡/元件图）
- [ ] 体积/内存回归记录
- [ ] 自动更新、代码签名

## 体积/内存

| 指标 | 预算 | 现状 |
| --- | --- | --- |
| debug exe | — | 20.7 MB |
| release exe | ≤20 MB | **8.4 MB** ✅ |
| release exe | ≤20 MB | 见 `gaiZao/tauri/target/release/velagent.exe` |
| 安装包 | ≤25 MB | 待测（Tauri bundler 需联网下载 NSIS/WiX） |
| 空闲内存 | ≤250 MB | 待测 |
