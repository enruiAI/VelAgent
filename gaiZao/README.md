# gaiZao —— VelAgent 对 DeepSeek Harness 的全部改造

VelAgent = **官方 DeepSeek Harness 的 fork**（底座只读） + `gaiZao/`（唯一自定义区）。

- 上游：<https://github.com/deepseek-ai/deepseek-harness>（MIT，版权归 DeepSeek）
- 本仓库整体许可证：**AGPLv3**（因为包含 Velxio AGPL 衍生代码）；上游 MIT 全文原样保留在
  `gaiZao/licenses/deepseekharness/`，Velxio 原版许可在 `gaiZao/licenses/velxio/`
- 所有能力都以 **bundle 插件** 形式挂在官方底座上：不改 `packages/`、不改注册文件、不复制资产进 `apps/web/public`

## 分支模型

```
official/master（官方 GitHub，只读，不自动同步）
   ↓ 只读对比（compare-upstream.ps1）→ 人工评估 → 选择性 cherry-pick
master = 官方镜像基线（只放官方 commit，不提交自己的改动）
   ↑ 对比用
dev    = 工作分支（全部 VelAgent 代码/文档 + 完整官方历史）
   ↓ sync-main-snapshot.ps1（生成单提交快照）
main   = 默认分支：dev 的单提交快照（公开仓库唯一分支，Contributors 只显示 owner）
origin = enruiAI/VelAgent（公开仓库，只放 main 快照）
```

> **公开仓库策略**：`origin` 只接收 `main` 快照（1 个提交），不推 `dev`/`master`，
> 这样 Contributors 只有 owner。完整官方历史保留在本地 `dev`/`master`；
> 需要云端备份时用 `push-velagent.ps1 -ArchiveRemote <备份仓库>`。
> 每次 `dev` 有更新后运行 `gaiZao/scripts/sync-main-snapshot.ps1` 刷新 `main`。

## 目录（六层）

```
gaiZao/
├─ features/                 # 功能层：每个功能一个 bundle，可独立安装/删除
│  ├─ velagent-workbench/    # 核心插件：宿主桥 + 路由 + velagent_* 工具 + 静态资产路由
│  ├─ velagent-ui/           # Velxio 改写前端（画布/编辑器/元件库），构建 embed 资产
│  ├─ velagent-brand/        # 品牌层：侧边栏产品名/图标/favicon（官方槽位）
│  └─ velagent-desktop/      # 独立桌面壳（Tauri，备用形态）
├─ foundation/templates/     # feature 脚手架
├─ overlays/                 # 汇总 cordis.patch.yml（bundle 模式下为空）
├─ patches/                  # 越界补丁（PATCHES.md + NNNN-*.diff），当前只有 0001 LICENSE
├─ docs/                     # 设计文档、台账、旧文档
├─ scripts/                  # 构建 / 安装 / 同步 / 校验 / 备份
└─ licenses/                 # 上游原版许可证（MIT / AGPL）——必须保留
```

## 构建

```powershell
# 1) 官方底座
pnpm install
$env:CI='1'; $env:DSH_CLIENT_COMMIT_HASH='0000000'; $env:DSH_CLIENT_TITLE='VelAgent'
pnpm build

# 2) Velxio 前端资产（输出到 gaiZao/features/velagent-ui/embed-dist）
cd gaiZao/features/velagent-ui
pnpm install
pnpm build:embed
cd ../../..

# 3) 插件 bundle（输出 index.js / client.js）
node gaiZao/scripts/build-features.mjs
```

## 安装与启动（唯一入口）

```powershell
# 一次性安装：把两个 bundle 装进 dsh profile web，并安装全局启动器
powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/install-velagent.ps1

# 之后任何目录
velagent
```

启动器 = `node apps/cli/lib/bin.js --profile web --port 2021 --no-open`，
`DSH_HOME=%APPDATA%\Enrui\VelAgent\data\harness-home`（与官方 dsh 隔离），自动打开带 token 的页面。
不安装全局命令时也可以用 `gaiZao/scripts/start.ps1`。

## 跟进上游（不自动同步）

本仓库**不会自动同步官方**。官方更新按“对比 → 评估 → 选择性采纳”处理：

```powershell
# 1) 只读对比：生成报告，列出官方新提交/改动文件/与我们补丁的重叠
powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/compare-upstream.ps1

# 2) 人工评估报告后，只 cherry-pick 需要的提交
powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -Commits <sha1>,<sha2>

# 3) （不推荐）明确决定全量跟进时才用
powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/apply-upstream.ps1 -FullMerge -ConfirmFullMerge
```

报告输出到 `gaiZao/docs/upstream-reports/upstream-<时间>.md`。
**不是所有官方功能都要跟进**：由人对照报告决定采纳范围，采纳后跑
`check-upstream-changes.ps1`（`gaiZao/` 之外的改动必须全部被补丁覆盖）再重新构建。

## 运维脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/build-features.mjs` | 构建所有 feature bundle（index.js / client.js） |
| `scripts/install-velagent.ps1` | 安装 bundle 进 profile + 全局 `velagent` 命令（`-Uninstall` 可卸） |
| `scripts/start.ps1` | 不装全局命令时的本地启动器 |
| `scripts/sync-main-snapshot.ps1` | 把 `main` 刷成 `dev` 的单提交快照（含许可证/来源自检） |
| `scripts/compare-upstream.ps1` | **只读**对比官方更新，生成评估报告（不合并） |
| `scripts/apply-upstream.ps1` | 按需采纳：默认只允许选择性 cherry-pick；全量需 `-FullMerge -ConfirmFullMerge` |
| `scripts/sync-upstream.ps1` | 兼容入口：已停用自动同步，调用会提示用 compare/apply |
| `scripts/check-upstream-changes.ps1` | 越界改动登记机检（`-Explain` 打印逐文件归属） |
| `scripts/init-overlay.ps1` | 重新生成 overlays/cordis.patch.yml |
| `scripts/backup.ps1` | 打 backup 标签并推送（可加 `-BundleDir` 出 git bundle） |
| `scripts/verify-*.mjs` | 协议 / 工作区 / 文件树端到端校验 |

## 许可证

- 根 `LICENSE` = **AGPLv3**（补丁 0001，替换官方 MIT）；
- `licenses/deepseekharness/`：上游 MIT 全文 + NOTICE + 第三方声明（**不要删除**）；
- `licenses/velxio/`：Velxio AGPLv3 + 商业许可说明 + NOTICE（**不要删除**）。
