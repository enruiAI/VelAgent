# upstream-reports —— 官方更新对比报告

`gaiZao/scripts/compare-upstream.ps1` 每次运行会在这里生成一份**只读**报告：

- 官方 `master..official/master` 的新提交清单；
- 官方改动的文件清单；
- 与我们的越界补丁重叠的文件（升级时最可能冲突的地方）；
- 官方是否动到 `gaiZao/`（正常应为空）；
- 选择性 cherry-pick 的操作提示。

报告只是用来评估的，不会改动任何分支。**是否采纳、采纳哪些提交，由人决定，不做自动同步。**
