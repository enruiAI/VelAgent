# velagent-ui —— Velxio 改写前端

上游 [Velxio](https://github.com/davidmonterocrespo24/velxio)（AGPLv3）前端的精简改写版：
只保留界面（Monaco 编辑器 + 电路画布 + 元件库），删除后端/编译/仿真，做中文化 + VelAgent 品牌。

- `src/`：React + Vite 源码（编辑器 / 画布 / 元件库 / i18n / embed 入口）
- `public/`：板卡与元件素材（Monaco 由 `postinstall` 生成）
- `scripts/`：`build:embed` 构建（产出 `velagent-embed.js` / `velxio-ui.css` / Monaco / 素材）
- `embed-dist/`：构建产物（gitignore）

构建：`pnpm install && pnpm build:embed`。
产物由 `features/velagent-workbench` 宿主的静态路由发出（`/velagent-assets/*` 等），
不再复制到 Harness 的 `apps/web/public`。

许可证：**AGPLv3**，上游原版许可见 `gaiZao/licenses/velxio/`。
