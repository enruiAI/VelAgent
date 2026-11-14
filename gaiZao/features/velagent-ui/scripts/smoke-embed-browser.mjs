#!/usr/bin/env node
/**
 * embed v2 真实浏览器冒烟（Edge headless + CDP，无第三方依赖）。
 *
 * 直接对「同步到 Harness public 的产物」做端到端验证（v2 API 兼容性；v3 的
 * mountWorkspace 工作台另见 smoke-workspace-browser.mjs）：
 *   1. 本地静态服务器提供 deepseek-harness/apps/web/public（同 Harness 同源场景）；
 *   2. 测试页加载 /velxio-ui.css + /velagent-embed.js，同时 mount 画布与 mountEditor；
 *   3. 断言 Monaco 从本地 /monaco/vs 加载成功、编辑器外壳/标签栏出现；
 *   4. 断言 v2 API（version/getCode/setCode/executeCommand/playTimeline/exportProject）；
 *   5. 把编辑器压到 360 / 拉到 900 宽截图（dock 可伸缩场景）。
 *
 * 用法：node VelAgent/gaiZao/chajian/velxio-ui/scripts/smoke-embed-browser.mjs [--keep]
 * 产物截图写到系统临时目录并打印路径。
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
const outDir = path.join(tmpdir(), 'velagent-embed-smoke-' + Date.now());
mkdirSync(outDir, { recursive: true });

const EDGE = process.env.VELAGENT_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(EDGE)) {
  console.log('跳过浏览器冒烟：找不到 Edge（可用 VELAGENT_EDGE 指定路径）。');
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

const TEST_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>embed v2 smoke</title>
<link rel="stylesheet" href="/velxio-ui.css">
<style>
  html, body { margin: 0; height: 100%; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  #wrap { display: flex; height: 100%; width: 100%; }
  #canvas { flex: 1 1 auto; min-width: 0; height: 100%; }
  #editor { flex: 0 0 420px; width: 420px; height: 100%; border-left: 1px solid #333; min-width: 0; }
</style></head>
<body>
  <div id="wrap"><div id="canvas"></div><div id="editor"></div></div>
  <script src="/velagent-embed.js"></script>
  <script>
    window.__smoke = { step: 'script-loaded' };
    try {
      const api = window.VelAgentEmbed;
      window.__smoke.version = api.version;
      window.__smoke.api = {
        mountEditor: typeof api.mountEditor,
        getCode: typeof api.getCode,
        setCode: typeof api.setCode,
        playTimeline: typeof api.playTimeline,
        exportProject: typeof api.exportProject,
      };
      window.__smoke.canvasDispose = typeof api.mount(document.getElementById('canvas'));
      window.__smoke.editorDispose = typeof api.mountEditor(document.getElementById('editor'));
      window.__smoke.step = 'mounted';
    } catch (error) {
      window.__smoke.error = String(error && error.stack ? error.stack : error);
    }
  </script>
</body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/embed-smoke.html') {
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

const port = 9400 + Math.floor(Math.random() * 200);
const profile = path.join(tmpdir(), 'velagent-embed-edge-' + Date.now());
const browser = spawn(
  EDGE,
  [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
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
  const waitFor = async (expression, timeoutMs = 45000, label = expression) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await evaluate(expression).catch(() => undefined);
      if (value) return value;
      await sleep(200);
    }
    return undefined;
  };
  const screenshot = async (name, clip) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const file = path.join(outDir, name);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: origin + '/embed-smoke.html' });
  await waitFor('document.readyState === "complete"', 30000, 'page load');

  const smoke = await evaluate('window.__smoke');
  check('测试页加载 embed 脚本', Boolean(smoke) && smoke.step === 'mounted', JSON.stringify(smoke));
  check('embed version >= 2', typeof smoke?.version === 'number' && smoke.version >= 2, String(smoke?.version));
  check('v2 API 齐全', ['mountEditor', 'getCode', 'setCode', 'playTimeline', 'exportProject'].every((key) => smoke?.api?.[key] === 'function'), JSON.stringify(smoke?.api));

  // Monaco 首次加载：从本地 /monaco/vs 拉 loader.js + editor.main.js + worker。
  const monacoReady = await waitFor('Boolean(document.querySelector("#editor .monaco-editor"))', 45000, 'monaco ready');
  check('Monaco 编辑器渲染到 mountEditor 容器', Boolean(monacoReady));
  const monacoResources = await evaluate(
    'performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/monaco/vs/"))',
  );
  check(
    'Monaco 资源来自同源 /monaco/vs',
    Array.isArray(monacoResources) && monacoResources.length > 0 && monacoResources.every((name) => name.startsWith(origin + '/monaco/vs/')),
    (monacoResources ?? []).length + ' 个资源',
  );
  check(
    'Monaco AMD loader 已就绪',
    await evaluate('Boolean(window.monaco && window.monaco.editor)'),
  );

  const tabs = await evaluate(
    '[...document.querySelectorAll("#editor .velxio-embed-editor__tabs button")].map((button) => button.textContent)',
  );
  check('文件标签栏显示 sketch.ino', Array.isArray(tabs) && tabs.some((tab) => String(tab).includes('sketch.ino')), JSON.stringify(tabs));

  const canvasChildren = await evaluate('document.getElementById("canvas").childElementCount');
  check('画布同页面同时挂载', canvasChildren > 0, 'children=' + canvasChildren);

  // ── v2 API 行为 ──────────────────────────────────────────────────────────
  const apiResult = await evaluate(`(async () => {
    const api = window.VelAgentEmbed;
    const before = api.getCode();
    const created = await api.setCode({ name: 'smoke.ino', content: '// smoke from browser' });
    // 新建文件后标签栏/编辑器要等一次 React 渲染 + Monaco 换模型。
    await new Promise((resolve) => setTimeout(resolve, 800));
    const after = api.getCode();
    const tabsAfter = [...document.querySelectorAll('#editor .velxio-embed-editor__tabs button')].map((button) => button.textContent);
    const command = await api.executeCommand({ op: 'code_get' });
    const play = await api.executeCommand({ op: 'timeline_play', timeline: [{ t: 0, serial: 'hello' }] });
    const stop = await api.executeCommand({ op: 'timeline_stop' });
    const editorModel = window.monaco.editor.getModels().map((model) => model.getValue()).join(String.fromCharCode(10));
    return {
      beforeActive: before.active,
      created: created.name,
      afterActive: after.active,
      afterContent: after.files.find((file) => file.name === 'smoke.ino')?.content ?? null,
      commandActive: command.result?.active ?? null,
      durationMs: play.result?.durationMs ?? null,
      stopped: stop.result?.stopped ?? null,
      editorModelHasSmoke: editorModel.includes('smoke from browser'),
      tabsAfter,
    };
  })()`);
  check('浏览器内 setCode 新建文件', apiResult?.created === 'smoke.ino' && apiResult?.afterActive === 'smoke.ino', JSON.stringify(apiResult));
  check('Monaco 模型同步新代码', apiResult?.editorModelHasSmoke === true);
  check('标签栏出现新文件 smoke.ino', Array.isArray(apiResult?.tabsAfter) && apiResult.tabsAfter.some((tab) => String(tab).includes('smoke.ino')), JSON.stringify(apiResult?.tabsAfter));
  check('浏览器内 code_get 命令', apiResult?.commandActive === 'smoke.ino', String(apiResult?.commandActive));
  check('浏览器内 timeline_play/stop', apiResult?.durationMs === 0 && apiResult?.stopped === true, JSON.stringify({ durationMs: apiResult?.durationMs, stopped: apiResult?.stopped }));

  // ── dock 伸缩宽度：360 / 900 ────────────────────────────────────────────
  const measure = () => evaluate(`(() => {
    const editor = document.getElementById('editor');
    const host = editor.querySelector('.monaco-editor');
    return { editorWidth: editor.getBoundingClientRect().width, monacoWidth: host ? host.getBoundingClientRect().width : 0, tabsOverflow: editor.querySelector('.velxio-embed-editor__tabs').scrollWidth > editor.querySelector('.velxio-embed-editor__tabs').clientWidth };
  })()`);
  for (const width of [360, 900]) {
    await evaluate(`(() => { const editor = document.getElementById('editor'); editor.style.flex = '0 0 ${width}px'; editor.style.width = '${width}px'; return true; })()`);
    await sleep(700);
    const metrics = await measure();
    check(
      '宽度 ' + width + 'px 下 Monaco 自适应',
      metrics && Math.abs(metrics.monacoWidth - width) < 2,
      JSON.stringify(metrics),
    );
    const rect = await evaluate(
      "(() => { const r = document.getElementById('editor').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()",
    );
    const file = await screenshot('editor-' + width + '.png', rect);
    console.log('screenshot:', file);
  }
  const fullShot = await screenshot('embed-v2-full.png');
  console.log('screenshot:', fullShot);

  // 关键错误：只过滤与本次功能相关的，忽略 jsdom/画布自定义元素之类的既有噪音。
  const relevantErrors = [...pageErrors, ...consoleErrors].filter(
    (text) => /monaco|velagent-embed|VelAgentEmbed|embed\.tsx|TypeError|ReferenceError/i.test(text) && !/NotSupportedError|component metadata/i.test(text),
  );
  check('页面无相关运行时错误', relevantErrors.length === 0, relevantErrors.slice(0, 5).join(' | '));

  console.log('截图目录:', outDir);
  console.log('');
  console.log(failures === 0 ? 'ALL BROWSER SMOKE CHECKS PASSED' : failures + ' BROWSER SMOKE CHECK(S) FAILED');
} catch (error) {
  failures += 1;
  console.error('浏览器冒烟异常：', error);
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
