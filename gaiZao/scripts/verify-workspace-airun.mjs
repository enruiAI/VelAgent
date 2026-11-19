import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'

const appUrl = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9980 + Math.floor(Math.random() * 30)
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + join(tmpdir(), 'vairun2-' + Date.now()), '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); if (targets.some(t => t.type === 'page')) break } catch {} await sleep(200) }
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let id = 1
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text) })
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = id++; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result?.value }
const health = async () => { try { return await (await fetch('http://127.0.0.1:2021/velagent/canvas/health')).json() } catch { return null } }
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync('D:/07_Code/Code/硬件学习/硬件学习总文件夹/AI尝试开发硬件/velxio开发/VelAgent/gaiZao/docs/' + name, Buffer.from(s.data, 'base64')) }

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: appUrl })
await sleep(3000)
await evalJs("(() => { const nodes = [...document.querySelectorAll('div, span, a, button')]; const hit = nodes.reverse().find(n => (n.textContent || '').includes('面包板与蓝色') && n.offsetParent !== null && n.children.length <= 2); if (hit) hit.click(); return !!hit })()")
await sleep(3500)
console.log('dock:', await evalJs("(() => { const list = [...document.querySelectorAll('button')].filter(n => ((n.textContent || '').includes('工作台') || (n.title || '').includes('工作台')) && n.offsetParent !== null && n.getBoundingClientRect().top < 200); if (!list.length) return 'no-header'; list[0].click(); return 'clicked' })()"))
await sleep(9000)
console.log('workspace:', await evalJs("(() => { const dock = document.querySelector('[role=complementary]'); if (!dock) return JSON.stringify({ dock: false }); const r = dock.getBoundingClientRect(); const text = dock.innerText; return JSON.stringify({ dock: true, w: Math.round(r.width), h: Math.round(r.height), brand: text.includes('VelAgent'), menus: ['文件','编辑','视图','帮助'].every(m => text.includes(m)), aiRun: text.includes('AI 运行'), fileTree: text.includes('sketch.ino'), monaco: !!dock.querySelector('.monaco-editor'), canvas: !!dock.querySelector('[data-velxio-embed]'), statusBar: /\d+ 板卡/.test(text), connected: text.includes('已连接') }) })()"))
await shot('debug-integration-workspace.png')
console.log('aiRun:', await evalJs("(() => { const dock = document.querySelector('[role=complementary]'); if (!dock) return 'no-dock'; const b = [...dock.querySelectorAll('button')].find(n => (n.textContent || '').includes('AI 运行')); if (!b) return 'missing'; b.click(); return 'clicked' })()"))
let evidence = false
for (let cycle = 1; cycle <= 20; cycle += 1) {
  await sleep(7000)
  const h = await health()
  const recent = h?.recent ?? []
  const ack = recent.filter(r => r.kind === 'ack').length
  const body = await evalJs('document.body.innerText').catch(() => '')
  const failed = (body || '').includes('本轮运行失败')
  console.log('cycle', cycle, 'ack', ack, 'failed', failed)
  if (ack > 0) { evidence = true; break }
  if (failed) break
}
await sleep(10000)
await shot('debug-integration-workspace-airun.png')
const body = await evalJs('document.body.innerText').catch(() => '')
console.log('toolText:', /velagent_play_timeline|velagent_read_code|velagent_read_circuit/.test(body || ''))
console.log('evidence:', evidence, 'errors:', JSON.stringify(errors.slice(0, 4)))
ws.close(); browser.kill()
