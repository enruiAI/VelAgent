# feature-template

复制为 `gaiZao/features/<kebab-case-id>`，只改副本：

1. `src/` 写插件（`export const name` + `export function apply(ctx)`）；
2. `cordis.patch.yml` 声明插入行，插件路径用 `__GAIZAO_ROOT__` 占位；
3. 在 `gaiZao/features/README.md` 登记一行；
4. 运行 `gaiZao/scripts/init-overlay.ps1`（或手动同步 overlays）。
