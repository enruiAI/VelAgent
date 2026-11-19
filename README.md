<!-- gaiZao-patch 0002: VelAgent project intro on the upstream README -->
# VelAgent

VelAgent 是一个**电路实验 + AI 编程工作台**：底座是官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，原样保留），
全部改造集中在 [`gaiZao/`](./gaiZao/README.md)：

- `gaiZao/features/velagent-workbench` —— Harness 内置插件（画布 / 代码 / JSON / 工作区 dock、`velagent_*` 工具）；
- `gaiZao/features/velagent-ui` —— Velxio 改写前端（画布 + Monaco + 元件库，AGPLv3）；
- `gaiZao/features/velagent-brand` —— 品牌层（官方槽位）；
- `gaiZao/features/velagent-desktop` —— 独立桌面壳（备用）。

**启动**：`powershell -NoProfile -ExecutionPolicy Bypass -File gaiZao/scripts/install-velagent.ps1` 安装一次，之后任意目录运行 `velagent`（端口 2021，隔离数据目录）。
**上游更新**：`gaiZao/scripts/sync-upstream.ps1`（`master` 官方镜像 / `dev` 工作分支，越界改动必须登记补丁）。
**许可证**：整体 AGPLv3（根 `LICENSE`）；上游 DeepSeek Harness 仍是 MIT，原版许可证与 NOTICE 原样保留在 `gaiZao/licenses/`。

---
# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
