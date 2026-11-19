import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const appUrl = process.argv[2]
const wsFile = 'C:/Users/32713/Desktop/新建文件夹/blink.ino'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9500 + Math.floor(Math.random() * 40)
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + join(tmpdir(), 'vfs2-' + Date.now()), '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })
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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync('D:/07_Code/Code/硬件学习/硬件学习总文件夹/AI尝试开发硬件/velxio开发/VelAgent/gaiZao/docs/' + name, Buffer.from(s.data, 'base64')) }

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: appUrl })
await sleep(3000)
console.log('auth:', await evalJs("document.body.innerText.slice(0, 60)"))
await evalJs("(() => { const nodes = [...document.querySelectorAll('div, span, a, button')]; const hit = nodes.reverse().find(n => (n.textContent || '').includes('面包板') && n.offsetParent !== null && n.children.length <= 2); if (hit) hit.click(); return !!hit })()")
await sleep(4000)
console.log('dock button:', await evalJs("JSON.stringify([...document.querySelectorAll('button')].filter(n => n.offsetParent !== null && n.getBoundingClientRect().top < 120).map(n => (n.textContent || '').trim().slice(0, 18) + '|' + (n.title || '').slice(0, 24)))"))
await evalJs("(() => { const list = [...document.querySelectorAll('button')].filter(n => ((n.textContent || '').includes('工作台') || (n.title || '').includes('工作台')) && n.offsetParent !== null && n.getBoundingClientRect().top < 200); if (list.length) list[0].click(); return list.length })()")
await sleep(11000)
const tree = await evalJs("(() => { const dock = document.querySelector('[role=complementary]'); if (!dock) return 'no-dock'; const t = dock.innerText; return JSON.stringify({ root: t.includes('新建文件夹'), file: t.includes('blink.ino'), fake: t.includes('libraries.json'), realTitle: t.includes('真实文件'), head: t.slice(0, 140) }) })()")
console.log('tree:', tree)
const code = await evalJs("(() => { const c = window.VelAgentEmbed.getCode(); const active = c.files.find(f => f.name === c.active); return JSON.stringify({ active: c.active, files: c.files.map(f => f.name), head: (active ? active.content : '').slice(0, 70) }) })()")
console.log('code:', code)
console.log('disk before:', JSON.stringify(existsSync(wsFile) ? readFileSync(wsFile, 'utf8').slice(0, 60) : 'missing'))
console.log('setCode:', await evalJs("(async () => { try { await window.VelAgentEmbed.setCode({ content: '// edited from the Harness workbench / void setup() {}' }); return 'ok' } catch (e) { return 'error: ' + String(e) } })()"))
await sleep(2500)
console.log('disk after edit:', JSON.stringify(existsSync(wsFile) ? readFileSync(wsFile, 'utf8').slice(0, 80) : 'missing'))
writeFileSync(wsFile, '// changed by agent externally / void loop() {}', 'utf8')
await sleep(4000)
console.log('editor after external change:', JSON.stringify(await evalJs("(() => { const c = window.VelAgentEmbed.getCode(); const active = c.files.find(f => f.name === c.active); return (active ? active.content : '').slice(0, 80) })()")))
await shot('debug-shared-workspace.png')
console.log('errors:', JSON.stringify(errors.slice(0, 3)))
ws.close(); browser.kill()