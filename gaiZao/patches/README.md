# patches —— 越界补丁层

凡是 `gaiZao/` 之外的文件（上游）被改动，必须在这里登记：

- `PATCHES.md`：清单（文件 / 改了什么 / 为什么 / 决策时间 / 重放方式 / 状态）
- `NNNN-<描述>.diff`：补丁文件（`git diff master -- <files>` 产出）
- 官方文件内尽量留 `gaiZao-patch NNNN` 标记（JSON 无法写注释时在 PATCHES.md 注明豁免）

机检：`gaiZao/scripts/check-upstream-changes.ps1 -Explain`（迁移中，见 docs/upstream-changes.md）。
