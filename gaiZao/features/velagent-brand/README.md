# velagent-brand —— VelAgent 品牌层

通过官方槽位（`sidebar.brand.name` / `sidebar.brand.mark`）把侧边栏产品名与图标换成 VelAgent，
并把 favicon 指到 VelAgent 芯片图标（由 workbench 宿主从 `/velagent-assets/favicon.svg` 发出）。
页面标题由构建期 `DSH_CLIENT_TITLE=VelAgent` 提供。

bundle 形态与其它 feature 相同，构建：`node gaiZao/scripts/build-features.mjs velagent-brand`。
