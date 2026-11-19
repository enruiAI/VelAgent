#!/usr/bin/env node
/**
 * embed 产物验收：构建 + CSS 清理之后由 `pnpm build:embed` 自动执行。
 *
 * 1. velagent-embed.js 暴露 window.VelAgentEmbed 的完整桥接 API（契约 v3）；
 * 2. bundle 不包含 Tauri 桌面桥接实现（embed 构建把 @tauri-apps/api 别名成
 *    src/integration/tauriEmbedStub.ts 的浏览器空实现；VelAgent 自身用
 *    `__TAURI_INTERNALS__ in window` 判断桌面/浏览器分支，这个字面量是允许的）；
 * 3. Monaco 没有被打进 IIFE（体积闸门 + loader 走 /monaco/vs 静态资源）；
 * 4. embed-dist/monaco/vs 静态资源齐全（复制到 Harness public 的源）；
 * 5. velxio-ui.css 不含会污染 Harness 的全局 reset / 未作用域化通用规则。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findGlobalPollution } from './embed-css.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(projectRoot, 'embed-dist', 'velagent-embed.js');
const cssPath = path.join(projectRoot, 'embed-dist', 'velxio-ui.css');
const monacoRoot = path.join(projectRoot, 'embed-dist', 'monaco', 'vs');

const bundle = await readFile(bundlePath, 'utf8');
const css = await readFile(cssPath, 'utf8');

const REQUIRED_API = [
  ['window.VelAgentEmbed', /window\.VelAgentEmbed\s*=/],
  ['version: 3', /version:\s*3\b/],
  ['mountWorkspace', /mountWorkspace\s*[,:(]/],
  ['Tauri embed stub', /嵌入模式下忽略桌面桥接命令/],
  ['mount', /mount\s*[,:(]/],
  ['mountEditor', /mountEditor\s*[,:(]/],
  ['getState', /getState\s*[,:(]/],
  ['executeCommand', /executeCommand\s*[,:(]/],
  ['subscribe', /subscribe\s*[,:(]/],
  ['getCode', /getCode\s*[,:(]/],
  ['setCode', /setCode\s*[,:(]/],
  ['playTimeline', /playTimeline\s*[,:(]/],
  ['exportProject', /exportProject\s*[,:(]/],
];
/** bundle 体积上限：monaco（~15 MiB）误打进 IIFE 会立刻撞线。 */
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

const problems = [];
for (const [label, pattern] of REQUIRED_API) {
  if (!pattern.test(bundle)) problems.push(`bundle 缺少桥接 API 标记：${label}`);
}
// 只检查真正的桌面桥接实现标记；`__TAURI_INTERNALS__` 由 VelAgent 自己的
// isDesktop() 能力探测使用（'__TAURI_INTERNALS__' in window），浏览器里恒为 false，
// 不构成桌面依赖。
for (const marker of ['@tauri-apps/', '__TAURI_EVENT_PLUGIN_INTERNALS__', '__TAURI_INVOKE_KEY__']) {
  if (bundle.includes(marker)) problems.push(`bundle 意外包含 Tauri 桌面桥接实现：${marker}`);
}
if (!bundle.includes('/monaco/vs')) {
  problems.push('bundle 未配置 Monaco 本地路径 /monaco/vs（loader.config）');
}
if (bundle.length > MAX_BUNDLE_BYTES) {
  problems.push(
    `velagent-embed.js 体积 ${(bundle.length / 1024 / 1024).toFixed(1)} MiB 超过上限 ${(MAX_BUNDLE_BYTES / 1024 / 1024).toFixed(0)} MiB：Monaco 可能被打进了 IIFE（应走 /monaco/vs 静态资源）`,
  );
}

/** 递归统计目录大小，用于汇报 monaco 资产体积。 */
async function dirSize(directory) {
  let total = 0;
  let files = 0;
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const inner = await dirSize(full);
      total += inner.total;
      files += inner.files;
    } else {
      total += (await stat(full)).size;
      files += 1;
    }
  }
  return { total, files };
}

let monacoBytes = 0;
let monacoFiles = 0;
for (const required of ['loader.js', path.join('editor', 'editor.main.js'), path.join('editor', 'editor.main.css')]) {
  const target = path.join(monacoRoot, required);
  try {
    await stat(target);
  } catch {
    problems.push(`缺少 Monaco 静态资源：embed-dist/monaco/vs/${required}`);
  }
}
try {
  const measured = await dirSize(monacoRoot);
  monacoBytes = measured.total;
  monacoFiles = measured.files;
} catch (error) {
  problems.push(`无法读取 Monaco 静态资源目录：${String(error)}`);
}

for (const item of findGlobalPollution(css)) {
  problems.push(`velxio-ui.css ${item}`);
}
// 嵌入工作台的作用域 reset 必须打进 CSS（App.css 的全局 * reset 会被清理掉）。
if (!css.includes('[data-velxio-workspace]')) {
  problems.push('velxio-ui.css 缺少嵌入工作台作用域样式 [data-velxio-workspace]（embed-workspace.css 未打包？）');
}

if (problems.length > 0) {
  console.error('embed 产物检查失败：');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}

const size = (text) => (text.length / 1024).toFixed(1) + ' KiB';
const monacoSize = (monacoBytes / 1024 / 1024).toFixed(1) + ' MiB';
console.log(
  `embed 产物检查通过：velagent-embed.js ${size(bundle)}（契约 v3 API 齐全：mountWorkspace + v2，无 Tauri，Monaco 走 /monaco/vs），` +
    `monaco 静态资源 ${monacoSize}/${monacoFiles} 个文件，velxio-ui.css ${size(css)}（无全局 reset）。`,
);
