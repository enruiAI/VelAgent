#!/usr/bin/env node
/**
 * 共享工作区文件树冒烟（Edge headless + CDP，无第三方依赖，不弹窗）。
 *
 * 对「同步到 Harness public 的产物」验证 embed v3 mountWorkspace + WorkspaceProvider：
 *   1. 页面内 mock provider 模拟 /velagent/workspace/* 返回的 Harness 会话工作区；
 *   2. 文件树头部只显示工作区文件夹名（无 caption、无完整路径）；
 *   3. 真实文件/目录展示、默认打开第一个 .ino、内容来自 provider.read；
 *   4. VSCode 式文件操作：新建文件 / 新建文件夹 / 重命名 / 删除（provider 可选方法）；
 *   5. 编辑 debounce 600ms 写回、外部改动 2s 内自动重载；
 *   6. 帮助菜单只剩「GitHub 仓库」一项；
 *   7. 截图保存 VelAgent/gaiZao/docs/debug-workspace-filetree.png。
 *
 * 用法：node VelAgent/gaiZao/chajian/velxio-ui/scripts/smoke-shared-fs-browser.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(projectRoot, '..', '..', '..');
const publicDir = path.join(repoRoot, 'apps', 'web', 'public');
const docsDir = path.join(repoRoot, 'gaiZao', 'docs');
const screenshotPath = path.join(docsDir, 'debug-workspace-filetree.png');
const outDir = path.join(tmpdir(), 'velagent-filetree-smoke-' + Date.now());
mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const EDGE = process.env.VELAGENT_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(EDGE)) {
  console.log('跳过文件树浏览器冒烟：找不到 Edge（可用 VELAGENT_EDGE 指定路径）。');
  process.exit(0);
}
for (const required of ['velagent-embed.js', 'velxio-ui.css', 'components-metadata.json', 'monaco/vs/loader.js']) {
  if (!existsSync(path.join(publicDir, required))) {
    console.error('缺少 Harness public 产物：' + required + '（先跑 pnpm build:embed）');
    process.exit(1);
  }
}

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.html': 'text/html; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const INITIAL_FILES = {
  'blink.ino':
    '// blink from harness workspace\nvoid setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n}',
  'README.md': '# Harness session workspace\n\nThis file lives in the real session workspace.',
  'notes.txt': 'notes from the agent',
  'src/util.h': '#pragma once\nint util();',
};

const TEST_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>VelAgent shared workspace smoke</title>
<link rel="stylesheet" href="/velxio-ui.css">
<style>
  html, body { margin: 0; height: 100%; background: #0a0c11; color: #eee; font-family: system-ui, sans-serif; }
  #workspace { width: 1180px; height: 900px; }
</style></head>
<body>
  <div id="workspace"></div>
  <script src="/velagent-embed.js"></script>
  <script>
    (function () {
      var files = new Map(Object.entries(${JSON.stringify(INITIAL_FILES)}));
      // 不可编辑文件：工作台文件树应按扩展名过滤掉它。
      files.set('firmware.hex', ':020000040000FA');
      // 目录（相对工作区根目录的路径）。
      var dirs = new Set(['src']);
      var versions = new Map();
      files.forEach(function (_value, name) { versions.set(name, 1); });
      var calls = { list: 0, read: [], write: [], mkdir: [], rename: [], remove: [] };
      function childrenOf(dirPath) {
        var prefix = dirPath ? dirPath + '/' : '';
        var byName = new Map();
        files.forEach(function (value, filePath) {
          if (filePath.indexOf(prefix) !== 0) return;
          var rest = filePath.slice(prefix.length);
          if (rest.length === 0 || rest.indexOf('/') >= 0) return;
          byName.set(rest, { name: rest, type: 'file', bytes: value.length });
        });
        dirs.forEach(function (dirPathValue) {
          if (dirPathValue.indexOf(prefix) !== 0) return;
          var rest = dirPathValue.slice(prefix.length);
          if (rest.length === 0 || rest.indexOf('/') >= 0) return;
          byName.set(rest, { name: rest, type: 'directory' });
        });
        return Array.from(byName.values());
      }
      window.__ws = { files: files, dirs: dirs, versions: versions, calls: calls };
      window.__wsProvider = {
        list: function (dirPath) {
          calls.list += 1;
          var target = dirPath || '';
          if (target !== '' && !dirs.has(target)) return Promise.reject(new Error('not a workspace directory: ' + target));
          return Promise.resolve({
            root: '/home/agent/.dsh/sessions/2026/session-wsq',
            name: target === '' ? 'session-wsq' : target,
            entries: childrenOf(target),
          });
        },
        read: function (filePath) {
          calls.read.push(filePath);
          if (!files.has(filePath)) return Promise.reject(new Error('missing workspace file ' + filePath));
          return Promise.resolve({ text: files.get(filePath), version: String(versions.get(filePath) || 1) });
        },
        write: function (filePath, content) {
          calls.write.push({ path: filePath, content: content });
          files.set(filePath, content);
          versions.set(filePath, (versions.get(filePath) || 0) + 1);
          return Promise.resolve({ version: String(versions.get(filePath)) });
        },
        mkdir: function (dirPath) {
          calls.mkdir.push(dirPath);
          if (dirs.has(dirPath) || files.has(dirPath)) return Promise.reject(new Error('already exists: ' + dirPath));
          dirs.add(dirPath);
          return Promise.resolve();
        },
        rename: function (from, to) {
          calls.rename.push({ from: from, to: to });
          if (files.has(from)) {
            files.set(to, files.get(from));
            files.delete(from);
            versions.set(to, versions.get(from) || 1);
            return Promise.resolve();
          }
          if (dirs.has(from)) {
            var moved = new Map();
            files.forEach(function (value, filePath) {
              if (filePath === from || filePath.indexOf(from + '/') === 0) {
                moved.set(to + filePath.slice(from.length), value);
                files.delete(filePath);
              }
            });
            moved.forEach(function (value, filePath) { files.set(filePath, value); });
            dirs.delete(from);
            dirs.add(to);
            return Promise.resolve();
          }
          return Promise.reject(new Error('missing workspace path ' + from));
        },
        remove: function (target) {
          calls.remove.push(target);
          if (files.has(target)) { files.delete(target); return Promise.resolve(); }
          if (dirs.has(target)) { dirs.delete(target); return Promise.resolve(); }
          return Promise.reject(new Error('missing workspace path ' + target));
        },
      };
      window.__wsExternalUpdate = function (name, content) {
        files.set(name, content);
        versions.set(name, (versions.get(name) || 0) + 1);
      };
      window.__smoke = { step: 'script-loaded' };
      try {
        var api = window.VelAgentEmbed;
        window.__smoke.version = api.version;
        window.__smoke.hasMountWorkspace = typeof api.mountWorkspace === 'function';
        window.__smoke.dispose = api.mountWorkspace(document.getElementById('workspace'), {
          workspace: window.__wsProvider,
        });
        window.__smoke.disposeType = typeof window.__smoke.dispose;
        window.__smoke.step = 'mounted';
      } catch (error) {
        window.__smoke.error = String(error && error.stack ? error.stack : error);
      }
    })();
  </script>
</body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/shared-fs-smoke.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(TEST_PAGE);
      return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(publicDir, relative);
    if (!target.startsWith(path.resolve(publicDir) + path.sep) && target !== path.resolve(publicDir)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;

const port = 9800 + Math.floor(Math.random() * 150);
const profile = path.join(tmpdir(), 'velagent-filetree-edge-' + Date.now());
const browser = spawn(
  EDGE,
  [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1500,1100',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
/** 断言一次。 */
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

let ws;
try {
  let targets;
  for (let i = 0; i < 80; i += 1) {
    try {
      targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      if (targets.some((target) => target.type === 'page')) break;
    } catch {
      /* browser still starting */
    }
    await sleep(200);
  }
  const page = targets?.find((target) => target.type === 'page');
  if (!page) throw new Error('cannot reach Edge CDP');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails;
      pageErrors.push(detail?.exception?.description ?? detail?.text ?? 'unknown exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      consoleErrors.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
    }
    return result.result?.value;
  };
  const waitFor = async (expression, timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await evaluate(expression).catch(() => undefined);
      if (value) return value;
      await sleep(200);
    }
    return undefined;
  };
  const textOf = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`);
  const treeText = () => textOf('#workspace .velxio-tree');
  const monacoText = () =>
    evaluate('window.monaco ? window.monaco.editor.getModels().map((m) => m.getValue()).join(String.fromCharCode(10)) : ""');
  /** 点击文件树里 aria-label 匹配的元素。 */
  const clickLabel = (label) =>
    evaluate(`(() => {
      const node = [...document.querySelectorAll('#workspace [aria-label]')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!node) return false;
      node.click();
      return true;
    })()`);
  /** 在文件树 inline 输入框里输入并回车。 */
  const typeInTreeInput = (text) =>
    evaluate(`(() => {
      const input = document.querySelector('#workspace .velxio-tree-input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: origin + '/shared-fs-smoke.html' });
  await waitFor('document.readyState === "complete"', 30000);
  await waitFor('Boolean(document.querySelector("#workspace .va-header"))', 30000);

  const smoke = await evaluate('window.__smoke');
  check('mountWorkspace + workspace provider 挂载成功', Boolean(smoke) && smoke.step === 'mounted', JSON.stringify(smoke));
  check('embed version === 3', smoke?.version === 3, String(smoke?.version));
  check('mountWorkspace 返回 dispose', smoke?.disposeType === 'function', String(smoke?.disposeType));

  // ── 1. 文件树头部只显示文件夹名 ──────────────────────────────────────────
  const rootNameText = await textOf('#workspace .velxio-tree-root-name');
  const headerText = await textOf('#workspace .velxio-tree-header');
  const treeTextInitial = await treeText();
  check('头部只显示工作区文件夹名', rootNameText === 'session-wsq', rootNameText);
  check('头部不再有「工作区 · 真实文件」caption', !headerText.includes('工作区 · 真实文件'), headerText);
  check('头部不显示完整路径', !headerText.includes('/home/agent'), headerText);
  check('文件树显示真实文件与目录', treeTextInitial.includes('blink.ino') && treeTextInitial.includes('README.md') && treeTextInitial.includes('src'));
  check('文件树过滤不可编辑文件（firmware.hex）', !treeTextInitial.includes('firmware.hex'));
  check('文件树不再显示内置虚拟文件', !treeTextInitial.includes('libraries.json'));

  // ── 2. 默认打开第一个 .ino，内容来自 provider.read ───────────────────────
  await waitFor('Boolean(document.querySelector("#workspace .monaco-editor"))', 45000);
  const callsAfterLoad = await evaluate('JSON.parse(JSON.stringify(window.__ws.calls))');
  check('默认打开时调用 list', callsAfterLoad.list >= 1, 'list=' + callsAfterLoad.list);
  check('默认打开第一个 .ino（read blink.ino）', callsAfterLoad.read.includes('blink.ino'), JSON.stringify(callsAfterLoad.read));
  check('Monaco 内容来自真实工作区文件', (await monacoText()).includes('blink from harness workspace'));
  check('加载阶段不产生多余写回', callsAfterLoad.write.length === 0, JSON.stringify(callsAfterLoad.write));
  check('高亮当前打开文件 blink.ino', (await textOf('#workspace .velxio-tree-row.is-active .velxio-tree-name')) === 'blink.ino');

  // ── 3. 工具栏按钮可用（provider 提供全部操作） ───────────────────────────
  check('有「新建文件」按钮', (await evaluate('document.querySelector(\'#workspace [aria-label="新建文件"]\') !== null')) === true);
  check('有「新建文件夹」按钮', (await evaluate('document.querySelector(\'#workspace [aria-label="新建文件夹"]\') !== null')) === true);
  check('文件行有重命名按钮', (await evaluate('document.querySelector(\'#workspace [aria-label="重命名 README.md"]\') !== null')) === true);
  check('文件行有删除按钮', (await evaluate('document.querySelector(\'#workspace [aria-label="删除 README.md"]\') !== null')) === true);

  // ── 4. 新建文件（inline input → Enter → write 空文件并打开） ──────────────
  check('点「新建文件」出现 inline 输入框', (await clickLabel('新建文件')) && (await waitFor('Boolean(document.querySelector("#workspace .velxio-tree-input"))', 3000)) !== undefined);
  check('输入文件名并回车', (await typeInTreeInput('setup.h')) === true);
  const createdFile = await waitFor(
    'window.__ws.calls.write.find((item) => item.path === "setup.h" && item.content === "") ? true : null',
    5000,
  );
  check('新建文件调用 provider.write 创建空文件', Boolean(createdFile));
  check('新建后文件树出现 setup.h', (await waitFor('(document.querySelector("#workspace .velxio-tree")?.textContent ?? "").includes("setup.h")', 5000)) === true);
  check('新建后自动打开 setup.h', (await evaluate('document.querySelector("#workspace .velxio-tree-row.is-active .velxio-tree-name")?.textContent')) === 'setup.h');

  // ── 5. 新建文件夹 ───────────────────────────────────────────────────────
  check('点「新建文件夹」出现 inline 输入框', (await clickLabel('新建文件夹')) && (await waitFor('Boolean(document.querySelector("#workspace .velxio-tree-input"))', 3000)) !== undefined);
  check('输入文件夹名并回车', (await typeInTreeInput('lib')) === true);
  const createdFolder = await waitFor('window.__ws.calls.mkdir.indexOf("lib") >= 0 ? true : null', 5000);
  check('新建文件夹调用 provider.mkdir', Boolean(createdFolder));
  check('新建后文件树出现 lib 目录', (await waitFor('(document.querySelector("#workspace .velxio-tree")?.textContent ?? "").includes("lib")', 5000)) === true);

  // ── 6. 重命名（README.md → README2.md） ─────────────────────────────────
  check('点 README.md 重命名按钮', (await clickLabel('重命名 README.md')) === true);
  check('重命名出现 inline 输入框', (await waitFor('Boolean(document.querySelector("#workspace .velxio-tree-input"))', 3000)) !== undefined);
  check('输入新名字并回车', (await typeInTreeInput('README2.md')) === true);
  const renamed = await waitFor(
    'window.__ws.calls.rename.find((item) => item.from === "README.md" && item.to === "README2.md") ? true : null',
    5000,
  );
  check('重命名调用 provider.rename', Boolean(renamed));
  check('重命名后文件树出现 README2.md', (await waitFor('(document.querySelector("#workspace .velxio-tree")?.textContent ?? "").includes("README2.md")', 5000)) === true);
  check('重命名后旧名字消失', !(await treeText()).includes('README.md'));

  // ── 7. 删除（README2.md，需二次确认） ───────────────────────────────────
  check('点删除按钮进入待确认', (await clickLabel('删除 README2.md')) === true);
  check('出现确认删除按钮', (await waitFor('Boolean(document.querySelector(\'#workspace [aria-label="确认删除 README2.md"]\'))', 3000)) === true);
  check('确认删除调用 provider.remove', (await clickLabel('确认删除 README2.md')) && (await waitFor('window.__ws.calls.remove.indexOf("README2.md") >= 0 ? true : null', 5000)) === true);
  check('删除后文件树不再显示 README2.md', (await waitFor('!(document.querySelector("#workspace .velxio-tree")?.textContent ?? "").includes("README2.md")', 5000)) === true);

  // ── 8. 编辑 debounce 600ms 写回 + 外部改动自动重载 ──────────────────────
  // 前面新建/重命名/删除切换过活动文件，这里按名字写回初始打开的 blink.ino。
  await evaluate(
    'window.VelAgentEmbed.executeCommand({ op: "code_set", name: "blink.ino", content: "// edited in browser" })',
  );
  const written = await waitFor(
    'window.__ws.calls.write.find((item) => item.path === "blink.ino" && item.content === "// edited in browser") ? true : null',
    5000,
  );
  check('编辑 debounce 后 provider.write 写回真实文件', Boolean(written));
  await evaluate('window.__wsExternalUpdate("blink.ino", "// changed by harness agent")');
  // blink.ino 当前不是活动标签，验证 editor store（打开该文件时会显示新内容）。
  const reloaded = await waitFor(
    '(window.VelAgentEmbed.getCode().files.find((file) => file.name === "blink.ino")?.content ?? "").includes("changed by harness agent")',
    6000,
  );
  check('外部改动（Agent 改文件）自动重载', Boolean(reloaded));

  // ── 9. 帮助菜单只剩 GitHub ──────────────────────────────────────────────
  const helpOpened = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('#workspace .emb-trigger')].find((node) => (node.textContent ?? '').trim() === '帮助');
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  check('打开帮助菜单', helpOpened === true);
  const helpItems = await evaluate(
    "Array.from(document.querySelectorAll('#workspace .emb-menu .emb-item')).map((node) => (node.textContent ?? '').trim())",
  );
  check('帮助菜单只剩一项', Array.isArray(helpItems) && helpItems.length === 1, JSON.stringify(helpItems));
  check('帮助菜单是 GitHub 仓库', Array.isArray(helpItems) && helpItems[0].includes('GitHub'), JSON.stringify(helpItems));
  check('帮助菜单没有 Discord / Velxio', !String(helpItems).includes('Discord') && !String(helpItems).includes('Velxio'), JSON.stringify(helpItems));

  // ── 10. 截图（帮助菜单打开状态，同时可见纯文件夹名与新建按钮） ──────────
  const rect = await evaluate(
    "(() => { const r = document.getElementById('workspace').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()",
  );
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
  writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  const fullShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(outDir, 'filetree-full.png'), Buffer.from(fullShot.data, 'base64'));
  check('文件树截图已保存到 docs', existsSync(screenshotPath), screenshotPath);
  console.log('screenshot:', screenshotPath);

  // ── 11. 卸载 ────────────────────────────────────────────────────────────
  const emptied = await evaluate(
    "(() => { const el = document.getElementById('workspace'); const dispose = window.__smoke.dispose; if (typeof dispose !== 'function') return 'no-dispose'; dispose(); return el.childElementCount; })()",
  );
  await sleep(200);
  check('dispose 卸载工作台', emptied === 0, String(emptied));

  // ── 12. 运行时错误 ──────────────────────────────────────────────────────
  const relevantErrors = [...pageErrors, ...consoleErrors].filter(
    (text) => /VelAgentEmbed|mountWorkspace|workspace|TypeError|ReferenceError|is not a function/i.test(text) && !/NotSupportedError|component metadata/i.test(text),
  );
  check('页面无相关运行时错误', relevantErrors.length === 0, relevantErrors.slice(0, 5).join(' | '));

  console.log('截图目录:', outDir);
  console.log('');
  console.log(failures === 0 ? 'ALL FILETREE SMOKE CHECKS PASSED' : failures + ' FILETREE SMOKE CHECK(S) FAILED');
} catch (error) {
  failures += 1;
  console.error('文件树浏览器冒烟异常：', error);
} finally {
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  browser.kill();
  server.close();
}
process.exit(failures === 0 ? 0 : 1);
