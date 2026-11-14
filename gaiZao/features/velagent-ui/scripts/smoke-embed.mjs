#!/usr/bin/env node
/**
 * embed 产物的行为冒烟（无需浏览器）：用 jsdom 加载 embed-dist/velagent-embed.js，
 * 直接验证 v2 API 的纯逻辑部分：
 *
 *   - version / mountWorkspace / mount / mountEditor / getCode / setCode / playTimeline / exportProject 存在；
 *   - getCode 初始文件、setCode 写入活动文件 / 新建文件；
 *   - executeCommand 的 code_get / code_set / timeline_play / timeline_stop /
 *     export_project / place_board；
 *   - subscribe 能收到 store 变化（去抖后）；
 *   - mount / mountEditor 能挂载并返回可用的卸载函数（Monaco 资源不在 jsdom 里加载，
 *     只验证挂载生命周期与编辑器外壳）。
 *
 * jsdom 复用 deepseek-harness 已安装的依赖（VelAgent 前端本身不装 jsdom）；
 * 找不到时打印跳过并以 0 退出——bundle 结构验收在 verify-embed.mjs 里是硬闸门。
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(projectRoot, '..', '..', '..');
const bundlePath = path.join(projectRoot, 'embed-dist', 'velagent-embed.js');
const metadataPath = path.join(projectRoot, 'embed-dist', 'components-metadata.json');

const candidates = [
  path.join(repoRoot, 'node_modules', 'jsdom', 'lib', 'api.js'),
  path.join(projectRoot, 'node_modules', 'jsdom', 'lib', 'api.js'),
];
const jsdomApi = candidates.find((candidate) => existsSync(candidate));
if (!jsdomApi) {
  console.log('跳过 embed 行为冒烟：找不到 jsdom（deepseek-harness/node_modules 未安装）。');
  process.exit(0);
}
if (!existsSync(bundlePath)) {
  console.error('embed-dist/velagent-embed.js 不存在，先跑 pnpm build:embed。');
  process.exit(1);
}

const { JSDOM } = await import(pathToFileURL(jsdomApi).href);
/** 等 React 并发渲染 / store 订阅落定。 */
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
/** 断言一次。 */
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  { url: 'http://127.0.0.1:9/', runScripts: 'dangerously', pretendToBeVisual: true },
);
const { window } = dom;
// jsdom 缺失的浏览器 API：Monaco 加载 / 播放 / 导出 / 挂载都会碰到，补最小 stub。
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
if (window.URL.createObjectURL === undefined) {
  window.URL.createObjectURL = () => 'blob:velagent-smoke';
  window.URL.revokeObjectURL = () => {};
}
// 导出会点一个 <a download>，jsdom 不做真实导航。
window.HTMLAnchorElement.prototype.click = () => {};
// 画布元件目录在真实页面里由 /components-metadata.json 提供，这里喂构建产物。
const metadataText = existsSync(metadataPath) ? await readFile(metadataPath, 'utf8') : '{"components":[]}';
window.fetch = async (input) => {
  const url = String(input);
  if (url.includes('components-metadata.json')) {
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(metadataText) };
  }
  throw new Error('smoke: unexpected fetch ' + url);
};

const bundleSource = await readFile(bundlePath, 'utf8');
const script = window.document.createElement('script');
script.textContent = bundleSource;
window.document.head.appendChild(script);
await settle(50);

const api = window.VelAgentEmbed;
check('window.VelAgentEmbed 已安装', Boolean(api));
if (!api) {
  console.error('embed bundle 没有安装 window.VelAgentEmbed');
  process.exit(1);
}
check('version === 3', api.version === 3, String(api.version));
for (const name of ['mountWorkspace', 'mount', 'mountEditor', 'getState', 'executeCommand', 'subscribe', 'getCode', 'setCode', 'playTimeline', 'exportProject']) {
  check('API ' + name, typeof api[name] === 'function');
}

// ── getCode / setCode ─────────────────────────────────────────────────────
const initial = api.getCode();
check('getCode active', initial.active === 'sketch.ino', String(initial.active));
check('getCode files', initial.files.length === 1 && initial.files[0].name === 'sketch.ino');

await api.setCode({ content: 'void setup() {}\nvoid loop() {}' });
check('setCode 写活动文件', api.getCode().files[0].content.includes('void setup()'));

const created = await api.setCode({ name: 'extra.py', content: 'print("hi")' });
check('setCode 新建文件返回文件名', created.name === 'extra.py', created.name);
const afterCreate = api.getCode();
check('setCode 新建文件已进入列表', afterCreate.files.some((file) => file.name === 'extra.py'));
check('setCode 新建文件 content', afterCreate.files.find((file) => file.name === 'extra.py')?.content === 'print("hi")');
await api.setCode({ name: 'extra.py', content: 'print("again")' });
check('setCode 写已有文件', api.getCode().files.find((file) => file.name === 'extra.py')?.content === 'print("again")');

// ── executeCommand: code_get / code_set ───────────────────────────────────
const outcome = await api.executeCommand({ op: 'code_get' });
check('code_get 返回 workspace', Boolean(outcome.workspace && Array.isArray(outcome.workspace.boards)));
check('code_get result.active', outcome.result && outcome.result.active === 'extra.py', JSON.stringify(outcome.result?.active));

const writeOutcome = await api.executeCommand({ op: 'code_set', name: 'sketch.ino', content: '// via command' });
check('code_set 返回实际文件名', writeOutcome.result && writeOutcome.result.name === 'sketch.ino', JSON.stringify(writeOutcome.result));
check('code_set 内容已写入', api.getCode().files.find((file) => file.name === 'sketch.ino')?.content === '// via command');

// ── executeCommand: timeline_play / timeline_stop ─────────────────────────
const playbook = {
  timeline: [
    { t: 0, leds: {}, serial: 'boot' },
    { t: 600, leds: {}, serial: 'tick' },
  ],
  explain: 'smoke',
};
const playOutcome = await api.executeCommand({ op: 'timeline_play', timeline: playbook.timeline, explain: playbook.explain });
check('timeline_play 返回 durationMs', playOutcome.result && playOutcome.result.durationMs === 600, JSON.stringify(playOutcome.result));
const direct = api.playTimeline(playbook);
check('playTimeline 返回 stop()', direct && typeof direct.stop === 'function');
const stopOutcome = await api.executeCommand({ op: 'timeline_stop' });
check('timeline_stop 返回 ok', stopOutcome.result && stopOutcome.result.ok === true, JSON.stringify(stopOutcome.result));
direct.stop();

// 时间轴把 LED 状态写进画布快照（properties.state），停止后熄灭。
const led = api.getState().components.find((component) => component.metadata_id === 'led');
if (led) {
  await api.executeCommand({ op: 'timeline_play', timeline: [{ t: 0, leds: { [led.id]: true } }] });
  await settle(150);
  const lit = api.getState().components.find((component) => component.id === led.id)?.properties.state === true;
  check('timeline_play 点亮 LED', lit);
  const ledStop = await api.executeCommand({ op: 'timeline_stop' });
  await settle(80);
  const off = api.getState().components.find((component) => component.id === led.id)?.properties.state === false;
  check('timeline_stop 停止并熄灭 LED', off && ledStop.result?.stopped === true, JSON.stringify(ledStop.result));
} else {
  check('默认画布含 LED', false, '找不到 metadata_id=led 的元件');
}

let badPlaybookRejected = false;
try {
  await api.executeCommand({ op: 'timeline_play', timeline: 'nope' });
} catch {
  badPlaybookRejected = true;
}
check('timeline_play 参数非法时 reject', badPlaybookRejected);

// ── executeCommand: export_project ────────────────────────────────────────
const exportOutcome = await api.executeCommand({ op: 'export_project', name: 'smoke project' });
check(
  'export_project 返回 .vlx 文件名',
  exportOutcome.result && exportOutcome.result.name === 'smoke-project.vlx',
  JSON.stringify(exportOutcome.result),
);
check('exportProject 直调返回文件名', api.exportProject({ name: 'direct' }).name === 'direct.vlx');

// ── subscribe + store 变化（画布命令） ────────────────────────────────────
const boardsBefore = api.getState().boards.length;
const revisions = [];
const unsubscribe = api.subscribe((snapshot) => revisions.push(snapshot.revision));
const placed = await api.executeCommand({ op: 'place_board', kind: 'arduino-uno' });
check('place_board 返回 id', Boolean(placed.result && placed.result.id), JSON.stringify(placed.result));
await settle(250);
unsubscribe();
check('subscribe 收到变化快照', revisions.length > 0 && revisions[0] > 0, JSON.stringify(revisions));
check('getState 板卡数 +1', api.getState().boards.length === boardsBefore + 1, String(api.getState().boards.length));

// ── mount / mountEditor 生命周期 ─────────────────────────────────────────
const canvasHost = window.document.createElement('div');
window.document.body.appendChild(canvasHost);
try {
  const canvasDispose = api.mount(canvasHost);
  await settle(400);
  check('mount 挂载出内容', canvasHost.childElementCount > 0, 'children=' + canvasHost.childElementCount);
  check('mount 容器带作用域属性', canvasHost.dataset.velxioEmbed === '1');
  canvasDispose();
  check('mount dispose 清除内容', canvasHost.childElementCount === 0, 'children=' + canvasHost.childElementCount);
} catch (error) {
  check('mount 挂载', false, String(error));
}
const editorHost = window.document.createElement('div');
window.document.body.appendChild(editorHost);
try {
  const editorDispose = api.mountEditor(editorHost);
  await settle(400);
  check('mountEditor 返回 dispose', typeof editorDispose === 'function');
  check('mountEditor 容器带作用域属性', editorHost.dataset.velxioEmbed === '1');
  // Monaco 通过 /monaco/vs/loader.js 异步加载；jsdom 不加载外部资源，
  // 这里只验证编辑器外壳（文件标签栏）已挂载、卸载不抛错。
  check(
    'mountEditor 挂载出标签栏',
    editorHost.innerHTML.includes('velxio-embed-editor'),
    editorHost.innerHTML.slice(0, 120),
  );
  editorDispose();
} catch (error) {
  check('mountEditor 挂载', false, String(error));
}

// ── mountWorkspace：原始工作台（品牌头/活动栏/文件树/状态栏） ──────────────
const workspaceHost = window.document.createElement('div');
workspaceHost.style.height = '800px';
window.document.body.appendChild(workspaceHost);
try {
  let aiRunCalls = 0;
  const workspaceDispose = api.mountWorkspace(workspaceHost, { onAiRun: () => { aiRunCalls += 1; } });
  await settle(800);
  check('mountWorkspace 返回 dispose', typeof workspaceDispose === 'function');
  check(
    'mountWorkspace 容器带作用域属性',
    workspaceHost.dataset.velxioEmbed === '1' && workspaceHost.dataset.velxioWorkspace === '1',
    JSON.stringify({ embed: workspaceHost.dataset.velxioEmbed, workspace: workspaceHost.dataset.velxioWorkspace }),
  );
  check('mountWorkspace 渲染品牌头 VelAgent', workspaceHost.innerHTML.includes('VelAgent'));
  check('mountWorkspace 渲染活动栏 GitHub', workspaceHost.querySelector('[aria-label="GitHub 仓库"]') !== null);
  check('mountWorkspace 渲染文件树', workspaceHost.querySelector('.file-explorer') !== null);
  check('mountWorkspace 渲染底部状态栏', workspaceHost.querySelector('.va-statusbar') !== null);
  check('mountWorkspace 隐藏 AI 控制台入口', workspaceHost.querySelector('[aria-label="AI 控制台"]') === null);
  const runButton = [...workspaceHost.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('AI 运行'));
  if (runButton) runButton.click();
  await settle(80);
  check('工作台 AI 运行调用注入回调', aiRunCalls === 1, 'calls=' + aiRunCalls);
  workspaceDispose();
} catch (error) {
  check('mountWorkspace 挂载', false, String(error));
}

// ── mountWorkspace + WorkspaceProvider：文件树用 Harness 会话真实工作区 ─────
const realFiles = new Map([
  ['blink.ino', 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() {}'],
  ['README.md', '# Session workspace'],
  ['notes.txt', 'hello from harness'],
]);
const versions = new Map(Array.from(realFiles.keys()).map((name) => [name, 1]));
const wsCalls = { list: 0, read: [], write: [] };
const provider = {
  async list() {
    wsCalls.list += 1;
    return {
      root: '/home/agent/session-wsq',
      name: 'session-wsq',
      entries: Array.from(realFiles.keys()).map((name) => ({ name, type: 'file', bytes: realFiles.get(name).length })),
    };
  },
  async read(name) {
    wsCalls.read.push(name);
    if (!realFiles.has(name)) throw new Error('missing workspace file ' + name);
    return { text: realFiles.get(name), version: String(versions.get(name) ?? 1) };
  },
  async write(name, content) {
    wsCalls.write.push({ path: name, content });
    realFiles.set(name, content);
    versions.set(name, (versions.get(name) ?? 0) + 1);
    return { version: String(versions.get(name)) };
  },
};
const fsHost = window.document.createElement('div');
fsHost.style.height = '800px';
window.document.body.appendChild(fsHost);
try {
  const fsDispose = api.mountWorkspace(fsHost, { workspace: provider });
  await settle(900);
  /** 按 aria-label 找到文件树里的按钮。 */
  const byLabel = (label) => fsHost.querySelector('[aria-label="' + label + '"]');
  /** 给受控输入框赋值并触发 React onChange。 */
  const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  /** 在输入框里按 Enter。 */
  const pressEnter = (input) => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };
  check('provider: list 被调用', wsCalls.list >= 1, 'list=' + wsCalls.list);
  check('provider: read 默认打开 .ino', wsCalls.read.includes('blink.ino'), JSON.stringify(wsCalls.read));
  check('provider: 默认打开第一个 .ino', api.getCode().active === 'blink.ino', String(api.getCode().active));
  check('provider: 编辑器内容来自真实文件', (api.getCode().files.find((f) => f.name === 'blink.ino')?.content ?? '').includes('pinMode(13, OUTPUT)'));
  const treeText = fsHost.querySelector('.file-explorer')?.textContent ?? '';
  check('provider: 文件树显示工作区目录名', treeText.includes('session-wsq'), treeText.slice(0, 120));
  check('provider: 文件树显示真实文件', treeText.includes('blink.ino') && treeText.includes('README.md'));
  check('provider: 文件树不再显示内置虚拟文件', !treeText.includes('libraries.json') && !treeText.includes('Arduino Uno'));
  check('provider: 有 write 时显示「新建文件」按钮', byLabel('新建文件') !== null);
  check('provider: 无 mkdir 时隐藏「新建文件夹」按钮', byLabel('新建文件夹') === null);
  check(
    'provider: 无 rename/remove 时隐藏重命名/删除按钮',
    fsHost.querySelector('[aria-label^="重命名"]') === null && fsHost.querySelector('[aria-label^="删除"]') === null,
  );
  check('provider: 加载阶段不产生多余写回', wsCalls.write.length === 0, JSON.stringify(wsCalls.write));

  // 编辑 → debounce 600ms 写回真实文件
  await api.setCode({ content: '// edited by smoke' });
  const writeDeadline = Date.now() + 2500;
  let written = null;
  while (Date.now() < writeDeadline) {
    written = wsCalls.write.find((item) => item.path === 'blink.ino');
    if (written) break;
    await settle(150);
  }
  check('provider: 编辑 debounce 后写回', Boolean(written) && written.content === '// edited by smoke', JSON.stringify(written));

  // 外部改动（Harness Agent 改文件）→ 2s 轮询自动重载
  realFiles.set('blink.ino', '// changed by harness agent');
  versions.set('blink.ino', (versions.get('blink.ino') ?? 0) + 1);
  let reloaded = false;
  const reloadDeadline = Date.now() + 4000;
  while (Date.now() < reloadDeadline) {
    const content = api.getCode().files.find((f) => f.name === 'blink.ino')?.content ?? '';
    if (content.includes('changed by harness agent')) {
      reloaded = true;
      break;
    }
    await settle(200);
  }
  check('provider: 外部改动自动重载', reloaded);

  // 文件树「新建文件」：点击 → inline input → Enter → write 空文件并打开
  {
    const newFileButton = byLabel('新建文件');
    newFileButton?.click();
    await settle(60);
    const input = fsHost.querySelector('.velxio-tree-input');
    check('provider: 点新建文件出现 inline 输入框', input !== null);
    if (input) {
      // 重名校验：同名文件应就地提示且不写文件。
      setInputValue(input, 'blink.ino');
      pressEnter(input);
      await settle(120);
      const validationText = fsHost.querySelector('.velxio-tree-error')?.textContent ?? '';
      check('provider: 新建重名校验就地提示', validationText.includes('同名') || validationText.includes('已存在'), validationText);
      check('provider: 重名时不写文件', !wsCalls.write.some((item) => item.path === 'blink.ino' && item.content === ''));

      const retryInput = fsHost.querySelector('.velxio-tree-input');
      if (retryInput) {
        setInputValue(retryInput, 'newfile.h');
        pressEnter(retryInput);
      }
      const createDeadline = Date.now() + 2500;
      let created = null;
      while (Date.now() < createDeadline) {
        created = wsCalls.write.find((item) => item.path === 'newfile.h');
        if (created) break;
        await settle(150);
      }
      check('provider: 新建文件调用 write 创建空文件', Boolean(created) && created.content === '', JSON.stringify(created));
      await settle(300);
      check('provider: 新建后文件树出现新文件', (fsHost.textContent ?? '').includes('newfile.h'));
      check('provider: 新建后自动打开新文件', api.getCode().active === 'newfile.h', String(api.getCode().active));
    }
  }

  fsDispose();
  await settle(100);
  check('provider: dispose 卸载工作台', fsHost.childElementCount === 0, String(fsHost.childElementCount));
} catch (error) {
  check('provider: 共享工作区挂载', false, String(error));
}

console.log('');
console.log(failures === 0 ? 'ALL SMOKE CHECKS PASSED' : failures + ' SMOKE CHECK(S) FAILED');
dom.window.close();
process.exit(failures === 0 ? 0 : 1);
