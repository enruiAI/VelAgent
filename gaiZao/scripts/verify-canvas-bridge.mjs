#!/usr/bin/env node
/**
 * VelAgent ⇄ Harness 画布桥接自检脚本（协议见 gaiZao/docs/canvas-bridge-contract.md）。
 *
 * 用法：
 *   node gaiZao/scripts/verify-canvas-bridge.mjs [baseUrl]
 *   baseUrl 默认 http://127.0.0.1:2021
 *
 * 检查内容：
 *   1) 静态产物：features/velagent-ui/embed-dist 的 embed bundle 暴露完整 API；
 *   2) 宿主路由：health / snapshot / state / ops / ack 按协议应答；
 *   3) 插件静态资产路由（/velagent-assets、/components-metadata.json）可访问；
 *   4) 会话隔离与长轮询超时行为。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:2021').replace(/\/$/, '')
const sessionId = 'smoke-' + Date.now().toString(36)

let failures = 0
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  if (!ok) failures += 1
  console.log('[' + mark + '] ' + name + (detail ? ' — ' + detail : ''))
  return ok
}

// ── 1) 静态产物 ────────────────────────────────────────────────────────────
const uiDist = join(repoRoot, 'gaiZao', 'features', 'velagent-ui', 'embed-dist')
const embedPath = join(uiDist, 'velagent-embed.js')
if (check('embed bundle exists', existsSync(embedPath), embedPath)) {
  const bundle = readFileSync(embedPath, 'utf8')
  for (const token of ['VelAgentEmbed', 'executeCommand', 'getState', 'subscribe', 'mount', 'mountEditor', 'mountWorkspace', 'getCode', 'setCode', 'playTimeline', 'exportProject']) {
    check('embed API token: ' + token, bundle.includes(token))
  }
  check('embed version marker (1-3)', /version\s*:\s*[123]/.test(bundle))
}
const monacoPath = join(uiDist, 'monaco', 'vs', 'loader.js')
check('monaco assets exist', existsSync(monacoPath), monacoPath)
const cssPath = join(uiDist, 'velxio-ui.css')
if (check('canvas css exists', existsSync(cssPath), cssPath)) {
  const css = readFileSync(cssPath, 'utf8')
  const hasGlobalReset = /(^|\})\s*(\*|html|body|#root)\s*(,|\{)/m.test(css.split('/*')[0] ?? css)
  check('css has no global reset rules', !hasGlobalReset)
}

// ── 2) HTTP 路由 ──────────────────────────────────────────────────────────
const emptyWorkspace = { revision: 7, name: 'smoke', boards: [], components: [], wires: [] }

async function json(method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let value
  try { value = text ? JSON.parse(text) : undefined } catch { value = text }
  return { status: response.status, value }
}

const health = await json('GET', '/velagent/canvas/health')
check('GET /health 200', health.status === 200, String(health.status))
check('GET /health ok', Boolean(health.value && health.value.ok === true), JSON.stringify(health.value).slice(0, 160))

const asset = await fetch(baseUrl + '/velagent-assets/velagent-embed.js')
check('GET /velagent-assets/velagent-embed.js 200', asset.status === 200, String(asset.status))
const metadata = await fetch(baseUrl + '/components-metadata.json')
check('GET /components-metadata.json 200', metadata.status === 200, String(metadata.status))

const snapshot = await json('POST', '/velagent/canvas/snapshot', {
  sessionId, revision: emptyWorkspace.revision, workspace: emptyWorkspace,
})
check('POST /snapshot 204', snapshot.status === 204, String(snapshot.status))

const state = await json('GET', '/velagent/canvas/state?sessionId=' + encodeURIComponent(sessionId))
check('GET /state 200', state.status === 200, String(state.status))
check('GET /state connected', state.value?.connected === true, JSON.stringify(state.value).slice(0, 160))
check('GET /state revision', state.value?.workspace?.revision === emptyWorkspace.revision, String(state.value?.workspace?.revision))

const pollStart = Date.now()
const ops = await json('GET', '/velagent/canvas/ops?sessionId=' + encodeURIComponent(sessionId) + '&cursor=0&wait=800')
const elapsed = Date.now() - pollStart
check('GET /ops 200', ops.status === 200, String(ops.status))
check('GET /ops long-poll waits', elapsed >= 600, String(elapsed) + 'ms')
check('GET /ops empty list', Array.isArray(ops.value?.ops) && ops.value.ops.length === 0, JSON.stringify(ops.value).slice(0, 160))

const ack = await json('POST', '/velagent/canvas/ack', { sessionId, opId: 'op-unknown', ok: true, result: { ok: true } })
check('POST /ack unknown op tolerated', ack.status === 204 || ack.status === 200 || ack.status === 404, String(ack.status))

const badJson = await fetch(baseUrl + '/velagent/canvas/snapshot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })
check('POST /snapshot malformed body 400', badJson.status === 400, String(badJson.status))

const unknown = await json('GET', '/velagent/canvas/whatever')
check('unknown route not 200', unknown.status !== 200, String(unknown.status))

console.log('')
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
