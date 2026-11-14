# 官方代码改动声明（越界台账 + 处置 SOP）

规则出处：`gaiZao/AGENTS.md` 第 3 节。逐条补丁登记表：`gaiZao/patches/PATCHES.md`。
**任何 agent 在同步官方更新前、解 `gaiZao/` 之外的冲突前，必须先读本文件。**

## 1. 现状

- 仓库：官方 DeepSeek Harness 的 fork（`master` = 官方镜像，`dev` = VelAgent 工作分支）；
- 当前越界改动：**3 条 active 补丁**（0001：根 `LICENSE` 改为 AGPLv3，上游 MIT 全文保留在
  `gaiZao/licenses/deepseekharness/`）；
- 其他所有能力都通过 **bundle 插件** 实现（`gaiZao/features/*`，`dsh plugin add` 安装）+ 插件宿主静态路由，
  官方源码零改动；
- 机检：`gaiZao/scripts/check-upstream-changes.ps1 -Explain`（核对 `dev` 相对 `master` 的
  `gaiZao/` 之外改动是否全部被 `gaiZao/patches/*.diff` 覆盖）。

## 2. 台账

| 官方文件 | 补丁 | 这条改动做什么 | 为什么官方扩展点做不到 | 决策时间 |
| --- | --- | --- | --- | --- |
| `README.md` | 0002 | 顶部插入 VelAgent 项目介绍块（定位 / 启动 / 目录 / 许可证），官方正文保留 | GitHub 首页需要展示本 fork 的项目与启动方式，官方 README 无覆盖机制 | 2026-11-13 13:35 |
| `.github/dependabot.yml` | 0003 | 删除上游继承的 Dependabot 配置，停止自动 PR/分支噪音 | fork 仓库不需要上游的自动依赖升级；依赖升级通过 sync-upstream 统一处理 | 2026-11-14 09:45 |
| `LICENSE` | 0001 | 根许可证 MIT → AGPLv3（上游 MIT 全文保留在 `gaiZao/licenses/deepseekharness/`） | 产品整体包含 Velxio AGPL 衍生代码，必须整体按 AGPLv3 分发；MIT 部分的声明义务通过保留原版 LICENSE/NOTICE 满足 | 2026-11-13 13:10 |

## 3. 跟进官方更新时的处置（不自动同步）

1. 只读对比：`gaiZao/scripts/compare-upstream.ps1` 生成 `gaiZao/docs/upstream-reports/upstream-<时间>.md`
   （官方新提交、改动文件、与登记补丁的重叠、是否动到 `gaiZao/`）；
2. 人工评估：**不是所有官方功能都要跟进**，按报告挑选需要的提交；
3. 选择性采纳：`gaiZao/scripts/apply-upstream.ps1 -Commits <sha...>`（默认只允许 cherry-pick；
   全量 merge 必须显式 `-FullMerge -ConfirmFullMerge`，不推荐）；
4. 采纳后运行 `check-upstream-changes.ps1 -Explain`，必须退出码 0；`LICENSE` 若被官方改动，按 0001 重放
   （用 `gaiZao/licenses/AGPL-3.0.txt` 覆盖）；
5. 官方若修改 LICENSE 文本（概率极低），先停下向用户说明，再更新 0001 的 diff 与登记。
