#!/usr/bin/env node
/**
 * 构建后自动执行：从 embed-dist/velxio-ui.css 剔除会污染 Harness 界面的
 * 全局 reset（*, html, body, #root），并把通用交互规则限定到画布容器。
 *
 * 由 `pnpm build:embed` 在 vite 构建之后调用，输出可重复执行（幂等）。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanCss } from './embed-css.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(projectRoot, 'embed-dist', 'velxio-ui.css');

const { css, removed, scoped, suspicious } = cleanCss(await readFile(cssPath, 'utf8'));

if (removed.length === 0 && scoped.length === 0) {
  console.log('CSS 清理：无全局规则需要处理（产物已干净）。');
} else {
  await writeFile(cssPath, css, 'utf8');
  console.log(`CSS 清理：移除 ${removed.length} 条全局规则，作用域化 ${scoped.length} 条。`);
  for (const item of removed) console.log('  - 删除 ' + item);
  for (const item of scoped) console.log('  * 作用域 ' + item);
}

if (suspicious.length > 0) {
  console.warn('警告：产物中仍有裸元素选择器（如 button/svg），不会自动删除，请人工确认是否污染 Harness：');
  for (const item of suspicious) console.warn('  ! ' + item);
}
