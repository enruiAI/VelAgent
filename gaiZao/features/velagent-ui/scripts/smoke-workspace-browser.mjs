#!/usr/bin/env node
/**
 * embed v3 原始工作台冒烟（Edge headless + CDP，无第三方依赖，不弹窗）。
 *
 * 直接对「同步到 Harness public 的产物」做端到端验证 mountWorkspace：
 *   1. 本地静态服务器提供 deepseek-harness/apps/web/public（同 Harness 同源场景）；
 *   2. 测试页加载 /velxio-ui.css + /velagent-embed.js，调用
 *      mountWorkspace(container, { onAiRun })；
 *   3. 断言独立版工作台骨架：VelAgent 品牌头 / 左侧活动栏（文件树 + AI 运行 +
 *      GitHub + 使用说明）/ 文件树 / Monaco 编辑器 / 电路画布 / 底部状态栏；
 *      并确认 Tauri 专属的 AI 控制台、AI 设置、AI 助手、Harness 官方界面入口被隐藏；
 *   4. 断言「AI 运行」在 embedded + onAiRun 时只调用宿主回调（不走本地预测）；
 *      再验证不传 onAiRun 时回退本地规则预测且不报错；
 *   5. 截图保存到 VelAgent/gaiZao/docs/debug-workspace-original.png。
 *
 * 用法：node VelAgent/gaiZao/chajian/velxio-ui/scripts/smoke-workspace-browser.mjs
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
const screenshotPath = path.join(docsDir, 'debug-workspace-original.png');
const outDir = path.join(tmpdir(), 'velagent-workspace-smoke-' + Date.now());
mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

const EDGE = process.env.VELAGENT_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!existsSync(EDGE)) {
  console.log('跳过工作台浏览器冒烟：找不到 Edge（可用 VELAGENT_EDGE 指定路径）。');
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
<html><head><meta charset="utf-8"><title>VelAgent workspace smoke</title>
<link rel="stylesheet" href="/velxio-ui.css">
<style>
  html, body { margin: 0; height: 100%; background: #0a0c11; color: #eee; font-family: system-ui, sans-serif; }
  #workspace { width: 1180px; height: 900px; }
  #workspace-2 { width: 900px; height: 700px; }
</style></head>
<body>
  <div id="workspace"></div>
  <div id="workspace-2" style="display:none"></div>
  <script src="/velagent-embed.js"></script>
  <script>
    window.__aiRunCount = 0;
    window.__smoke = { step: 'script-loaded' };
    try {
      const api = window.VelAgentEmbed;
      window.__smoke.version = api.version;
      window.__smoke.hasMountWorkspace = typeof api.mountWorkspace === 'function';
      window.__smoke.dispose = api.mountWorkspace(document.getElementById('workspace'), {
        onAiRun: function () { window.__aiRunCount += 1; },
      });
      window.__smoke.disposeType = typeof window.__smoke.dispose;
      window.__smoke.step = 'mounted';
    } catch (error) {
      window.__smoke.error = String(error && error.stack ? error.stack : error);
    }
  </script>
</body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/workspace-smoke.html') {
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

const port = 9600 + Math.floor(Math.random() * 200);
const profile = path.join(tmpdir(), 'velagent-workspace-edge-' + Date.now());
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
  const consoleWarnings = [];
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'warning') {
      consoleWarnings.push((message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' '));
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
  const waitFor = async (expression, timeoutMs = 45000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = await evaluate(expression).catch(() => undefined);
      if (value) return value;
      await sleep(200);
    }
    return undefined;
  };
  const screenshot = async (file, clip) => {
    const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  };
  const textOf = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: origin + '/workspace-smoke.html' });
  await waitFor('document.readyState === "complete"', 30000);
  await waitFor('Boolean(document.querySelector("#workspace .va-header"))', 30000);

  // ── 1. 脚本与挂载 ───────────────────────────────────────────────────────
  const smoke = await evaluate('window.__smoke');
  check('embed 脚本加载并 mountWorkspace 成功', Boolean(smoke) && smoke.step === 'mounted', JSON.stringify(smoke));
  check('embed version === 3', smoke?.version === 3, String(smoke?.version));
  check('mountWorkspace 存在且返回 dispose', smoke?.hasMountWorkspace === true && smoke?.disposeType === 'function', JSON.stringify({ has: smoke?.hasMountWorkspace, dispose: smoke?.disposeType }));
  const attrs = await evaluate(
    "(() => { const el = document.getElementById('workspace'); return { embed: el.dataset.velxioEmbed, workspace: el.dataset.velxioWorkspace }; })()",
  );
  check('挂载容器带 [data-velxio-embed] + workspace 作用域', attrs?.embed === '1' && attrs?.workspace === '1', JSON.stringify(attrs));

  // ── 2. 原始工作台骨架 ───────────────────────────────────────────────────
  check('品牌头显示 VelAgent', (await textOf('#workspace .va-brand-name')) === 'VelAgent');
  check('品牌副标题 AI 硬件实验台', (await textOf('#workspace .va-brand-tag')) === 'AI 硬件实验台');
  check('顶部菜单栏存在', (await textOf('#workspace .app-header')).length > 0);
  check('视图切换（代码/分栏/电路）存在', (await evaluate('document.querySelectorAll("#workspace .va-viewswitch button").length')) === 3);
  const exportText = await evaluate(
    "[...document.querySelectorAll('#workspace button')].map((b) => (b.textContent ?? '').trim()).find((t) => t.includes('导出')) ?? null",
  );
  check('导出 .vlx 按钮保留', typeof exportText === 'string' && exportText.includes('导出'), String(exportText));
  check('左侧活动栏存在', (await evaluate('document.querySelectorAll("#workspace .va-rail").length')) === 1);
  for (const label of ['文件树', 'AI 运行', 'GitHub 仓库', '使用说明']) {
    check('活动栏保留 ' + label, (await evaluate(`document.querySelector('#workspace [aria-label="${label}"]') !== null`)) === true);
  }
  for (const label of ['AI 助手', 'Harness 官方界面', 'AI 控制台', 'AI 设置']) {
    check('嵌入模式隐藏 ' + label, (await evaluate(`document.querySelector('#workspace [aria-label="${label}"]') === null`)) === true);
  }
  check('顶部 AI 状态胶囊已隐藏', (await evaluate('document.querySelector("#workspace .va-status-pill") === null')) === true);
  check('文件树已渲染', (await evaluate('document.querySelector("#workspace .file-explorer") !== null')) === true);
  check('文件树含 sketch.ino', (await textOf('#workspace .file-explorer')).includes('sketch.ino'));
  check('电路画布已渲染', (await evaluate('document.querySelector("#workspace .simulator-panel")?.childElementCount > 0')) === true);
  check('底部状态栏已渲染', (await evaluate('document.querySelector("#workspace .va-statusbar") !== null')) === true);
  const statusbarText = await textOf('#workspace .va-statusbar');
  check('状态栏含工作台标识与画布统计', statusbarText.includes('VelAgent 工作台') && statusbarText.includes('板卡') && statusbarText.includes('元件'), statusbarText.slice(0, 120));

  // ── 3. Monaco 编辑器（本地静态资源） ────────────────────────────────────
  const monacoReady = await waitFor('Boolean(document.querySelector("#workspace .monaco-editor"))', 45000);
  check('Monaco 编辑器已渲染', Boolean(monacoReady));
  const monacoResources = await evaluate(
    'performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("/monaco/vs/"))',
  );
  check(
    'Monaco 资源来自同源 /monaco/vs',
    Array.isArray(monacoResources) && monacoResources.length > 0 && monacoResources.every((name) => name.startsWith(origin + '/monaco/vs/')),
    (monacoResources ?? []).length + ' 个资源',
  );

  // ── 4. AI 运行：embedded + onAiRun 只调用宿主回调 ───────────────────────
  const clickedRun = await evaluate(`(() => {
    const button = [...document.querySelectorAll('#workspace .app-header button')].find((b) => (b.textContent ?? '').includes('AI 运行'));
    if (!button) return 'missing';
    button.click();
    return 'clicked';
  })()`);
  await sleep(600);
  const aiRunCount = await evaluate('window.__aiRunCount');
  check('AI 运行按钮存在并点击', clickedRun === 'clicked', String(clickedRun));
  check('embedded + onAiRun：只调用宿主回调', aiRunCount === 1, 'count=' + aiRunCount);
  check('embedded + onAiRun：不出现本地运行预测面板', (await evaluate("document.body.textContent.includes('运行预测')")) === false);

  // ── 5. 截图（交付给 docs 的原始工作台外观） ──────────────────────────────
  const rect = await evaluate(
    "(() => { const r = document.getElementById('workspace').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()",
  );
  const shot = await screenshot(screenshotPath, rect);
  check('工作台截图已保存到 docs', existsSync(screenshotPath), shot);
  const fullShot = await screenshot(path.join(outDir, 'workspace-full.png'));
  console.log('screenshot:', shot);
  console.log('screenshot(trailing):', fullShot);

  // ── 6. dock 最小宽度（480px）下骨架仍完整 ────────────────────────────────
  await evaluate("(() => { const el = document.getElementById('workspace'); el.style.width = '480px'; el.style.height = '760px'; return true; })()");
  await sleep(900);
  const narrow = await evaluate("(() => { const el = document.getElementById('workspace'); return { width: el.getBoundingClientRect().width, monaco: Boolean(el.querySelector('.monaco-editor')), canvas: Boolean(el.querySelector('.simulator-panel')), statusbar: Boolean(el.querySelector('.va-statusbar')), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; })()");
  check('480px 宽下骨架仍完整', narrow?.monaco === true && narrow?.canvas === true && narrow?.statusbar === true, JSON.stringify(narrow));
  await screenshot(path.join(outDir, 'workspace-480.png'));
  console.log('screenshot(480):', path.join(outDir, 'workspace-480.png'));

  // ── 7. 卸载：容器清空 ───────────────────────────────────────────────────
  const emptied = await evaluate(
    "(() => { const el = document.getElementById('workspace'); const dispose = window.__smoke.dispose; if (typeof dispose !== 'function') return 'no-dispose'; dispose(); return el.childElementCount; })()",
  );
  await sleep(200);
  check('mountWorkspace dispose 卸载工作台', emptied !== 'no-dispose' && emptied === 0, String(emptied));

  // ── 8. 无 onAiRun：回退本地规则预测且不报错 ──────────────────────────────
  const fallback = await evaluate(`(async () => {
    const api = window.VelAgentEmbed;
    const host = document.getElementById('workspace-2');
    host.style.display = 'block';
    const dispose = api.mountWorkspace(host);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const button = [...host.querySelectorAll('.app-header button')].find((b) => (b.textContent ?? '').includes('AI 运行'));
    if (!button) return { error: 'missing AI run button', dispose: typeof dispose };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const panelText = document.body.textContent ?? '';
    return { hasPanel: panelText.includes('运行预测'), hasRuleSource: panelText.includes('规则预测'), dispose: typeof dispose };
  })()`);
  check('未注入 onAiRun 时回退本地规则预测', fallback?.hasPanel === true && fallback?.hasRuleSource === true, JSON.stringify(fallback));

  // ── 9. 运行时错误 ───────────────────────────────────────────────────────
  const workerWarnings = consoleWarnings.filter((text) => /worker/i.test(text));
  check('Monaco worker 无加载告警', workerWarnings.length === 0, workerWarnings.slice(0, 3).join(' | '));

  const relevantErrors = [...pageErrors, ...consoleErrors].filter(
    (text) => /VelAgentEmbed|mountWorkspace|velagent-embed|TypeError|ReferenceError|is not a function/i.test(text) && !/NotSupportedError|component metadata/i.test(text),
  );
  check('页面无相关运行时错误', relevantErrors.length === 0, relevantErrors.slice(0, 5).join(' | '));

  console.log('截图目录:', outDir);
  console.log('');
  console.log(failures === 0 ? 'ALL WORKSPACE SMOKE CHECKS PASSED' : failures + ' WORKSPACE SMOKE CHECK(S) FAILED');
} catch (error) {
  failures += 1;
  console.error('工作台浏览器冒烟异常：', error);
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
