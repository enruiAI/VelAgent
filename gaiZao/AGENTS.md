# gaiZao —— AI 助手开发守则

本文件适用于 VelAgent 仓库（DeepSeek Harness 的 fork）。
**任何 AI / agent 在本仓库动手前必须完整阅读本文件与 `gaiZao/README.md`。**

## 0. 一句话定位

本仓库 = 官方 `deepseek-ai/deepseek-harness` 的 fork（只读底座）
+ `gaiZao/` 目录（唯一允许改写的自定义区）。

## 1. 铁律（违反即错误）

1. **只允许修改 `gaiZao/` 内的文件**。`packages/`、`apps/`、`vendor/`、`docs/`、`scripts/`、
   `package.json`、`tsconfig*`、`pnpm-*` 等官方文件一律视为只读。
2. **改官方文件必须先登记补丁**（`gaiZao/patches/PATCHES.md` + `gaiZao/docs/upstream-changes.md`），
   否则 `check-upstream-changes` 会报错。
3. **所有开发在 `dev` 分支**；`master` 是官方镜像基线（只放官方提交）；`main` 是 `dev` 的**单提交快照**（发布/展示用），
   不要直接把 `dev` 历史强推到 `main`，发版时运行 `gaiZao/scripts/sync-main-snapshot.ps1`。
4. 禁止 `rebase`、`reset --hard`、`push --force`（用户明确批准的迁移除外）。
5. 不得提交密钥、token、`.env`、`node_modules`、构建产物、临时文件。

## 2. 目录约定

| 位置 | 允许的改动 |
| --- | --- |
| `gaiZao/features/<id>/` | 新功能：插件源码、功能 README、本功能 `cordis.patch.yml`、其下 patches/tests |
| `gaiZao/foundation/templates/` | 脚手架模板 |
| `gaiZao/foundation/shared/` | 2 个以上 feature 复用的代码 |
| `gaiZao/overlays/` | 只通过 `init-overlay` 重新生成，不手改 |
| `gaiZao/patches/` | 越界补丁 diff + `PATCHES.md` 登记 |
| `gaiZao/docs/`、`gaiZao/scripts/`、`gaiZao/licenses/` | 文档、工具、许可证 |

## 3. 越界修改流程（唯一豁免通道）

1. 在 `gaiZao/patches/` 放补丁（`git diff master -- <file>` 或 `git format-patch`，命名 `NNNN-<描述>.diff`）；
2. 在 `gaiZao/patches/PATCHES.md` 登记：影响文件、改了什么、为什么官方扩展点做不到、决策时间、重放方式、状态；
3. 在 `gaiZao/docs/upstream-changes.md` 台账同步加一行；
4. 尽量在官方文件内留 `gaiZao-patch NNNN` 标记（TS 用 `//`、md 用 `<!-- -->`、yaml 用 `#`）；
5. 提交信息以 `[patch]` 开头，一补丁一提交。

## 4. 官方更新：只对比，不自动同步

本仓库**禁止自动同步官方**。唯一正确流程：

1. `gaiZao/scripts/compare-upstream.ps1` —— 只读对比，生成 `gaiZao/docs/upstream-reports/` 报告；
2. 人工评估官方新增了什么、是否需要（不是所有功能都跟）；
3. `gaiZao/scripts/apply-upstream.ps1 -Commits <sha...>` 只 cherry-pick 需要的提交；
4. 全量 merge 属于例外，必须显式 `-FullMerge -ConfirmFullMerge`，且要先得到用户确认。

禁止：直接 `git merge official/master`、把官方整包合进 `dev`、或配置任何定时/自动同步。

## 4.1 main 快照（合规红线）

`sync-main-snapshot.ps1` 生成 `main` 单提交快照时，脚本会强制自检：

1. `LICENSE`、`gaiZao/licenses/**` 的许可证与 NOTICE 必须存在；
2. `README.md` 必须保留“基于 DeepSeek Harness（MIT）/ Velxio（AGPLv3）”的来源说明；
3. 快照 commit message 必须写明上游基线 commit；
4. `dev` / `master` 的完整上游历史不得删除或改写。

任何一项不满足，脚本会中止。

公开仓库（origin）**只允许**接收 `main` 快照，禁止把 `dev`/`master`/历史标签推上去——否则 Contributors 会重新出现上游作者。完整历史只留在本地，或用 `push-velagent.ps1 -ArchiveRemote` 推到单独的备份仓库。

## 5. 提交规范

`feat(gaiZao): <feature-id> <描述>` / `fix(gaiZao): …` / `docs(gaiZao): …` / `[patch] <上游路径>: …`
