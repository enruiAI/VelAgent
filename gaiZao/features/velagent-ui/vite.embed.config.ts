import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** 供 DSH 插件原生挂载的画布构建：输出 iife 全局 VelAgentEmbed。 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 嵌入构建把 Tauri 桌面桥接替换成浏览器空实现：工作台 UI 的 import 链
      // 会碰到 @tauri-apps/api，但 Harness dock 里没有 Tauri 运行时，不能让
      // 桌面桥接层被打进 IIFE（见 src/integration/tauriEmbedStub.ts）。
      '@tauri-apps/api/core': path.resolve(__dirname, 'src/integration/tauriEmbedStub.ts'),
      '@tauri-apps/api/event': path.resolve(__dirname, 'src/integration/tauriEmbedStub.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/embed.tsx'),
      formats: ['iife'],
      // 注意：global 名不能叫 VelAgentEmbed——IIFE 末尾的 `var <name> = (exports)`
      // 会覆盖模块内 `window.VelAgentEmbed = embedApi`，导致 version/mountEditor
      // 等非导出字段丢失（版本号变为 undefined）。用一个不同的名字，让
      // window.VelAgentEmbed 保持为 embed.tsx 显式安装的 API 对象。
      name: 'VelAgentEmbedBundle',
      fileName: () => 'velagent-embed.js',
    },
    outDir: 'embed-dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2020',
    minify: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
