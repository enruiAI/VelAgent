import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
//
// 这是 Velxio 的纯前端精简版：只保留界面（编辑器 + 电路画布 + 元件库），
// 没有后端、没有编译、没有仿真。原来的 /api 代理和 pro 覆盖层入口都已删除。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  define: {
    // utils/exampleThumbUrl.ts 需要这个编译期常量；精简版不再给缩略图算哈希。
    __EXAMPLE_THUMBS_VERSION__: JSON.stringify(''),
  },
  optimizeDeps: {
    include: ['@wokwi/elements'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'wokwi-elements': ['@wokwi/elements'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 8000,
  },
})
