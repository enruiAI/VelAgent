import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, existsSync } from 'node:fs'

const appUrl = process.argv[2]
const wsRoot = 'C:/Users/32713/Desktop/新建文件夹'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9600 + Math.floor(Math.random() * 40)
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + join(tmpdir(), 'vtree-' + Date.now()), '--no-first-run', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' })
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
await evalJs("(() => { const nodes = [...document.querySelectorAll('div, span, a, button')]; const hit = nodes.reverse().find(n => (n.textContent || '').includes('面包板') && n.offsetParent !== null && n.children.length <= 2); if (hit) hit.click(); return !!hit })()")
await sleep(4000)
console.log('auth:', await evalJs("document.body.innerText.slice(0, 60)"))
console.log('top buttons:', await evalJs("JSON.stringify([...document.querySelectorAll('button')].filter(n => n.offsetParent !== null && n.getBoundingClientRect().top < 120).map(n => ((n.textContent || '').trim().slice(0, 18)) + '|' + ((n.title || '').slice(0, 24))))"))
console.log('dock click:', await evalJs("(() => { const list = [...document.querySelectorAll('button')].filter(n => ((n.textContent || '').includes('工作台') || (n.title || '').includes('工作台')) && n.offsetParent !== null && n.getBoundingClientRect().top < 200); if (!list.length) return 'no-button'; list[0].click(); return 'clicked ' + list.length })()"))
await sleep(12000)
const dock = await evalJs("(() => { const d = document.querySelector('[role=complementary]'); if (!d) return 'no-dock'; const t = d.innerText; return JSON.stringify({ headerOnly: t.includes('新建文件夹') && !t.includes('工作区 · 真实文件') && !t.includes('C:\\Users'), hasFile: t.includes('blink.ino'), hasDir: t.includes('libtest'), buttons: [...d.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => ((b.title || '') + '|' + (b.getAttribute('aria-label') || '') + '|' + (b.textContent || '')).trim().slice(0, 30)).slice(0, 30) }) })()")
console.log('dock:', dock)
// help menu
await evalJs("(() => { const d = document.querySelector('[role=complementary]'); if (!d) return 'no-dock'; const b = [...d.querySelectorAll('button')].find(n => (n.textContent || '').trim() === '帮助'); if (b) b.click(); return !!b })()")
await sleep(800)
const help = await evalJs("(() => { const t = document.body.innerText; return JSON.stringify({ github: t.includes('GitHub'), discord: t.includes('Discord'), velxioHome: t.includes('Velxio 主页') }) })()")
console.log('help menu:', help)
await evalJs("(() => { document.body.click(); return true })()")
await sleep(500)
// new file via UI
const newFileClick = await evalJs("(() => { const d = document.querySelector('[role=complementary]'); if (!d) return 'no-dock'; const cands = [...d.querySelectorAll('button')]; const b = cands.find(n => /新建文件/.test((n.title || '') + (n.getAttribute('aria-label') || '') + (n.textContent || ''))); if (!b) return 'missing'; b.click(); return 'clicked' })()")
console.log('new file button:', newFileClick)
await sleep(800)
const inputs = await evalJs("(() => { const d = document.querySelector('[role=complementary]'); if (!d) return 'no-dock'; const list = [...d.querySelectorAll('input')].filter(n => n.offsetParent !== null); list.forEach(n => n.focus()); return JSON.stringify(list.map(n => ({ type: n.type, value: n.value, placeholder: n.placeholder }))) })()")
console.log('inputs:', inputs)
await send('Input.insertText', { text: 'newfile.ino' })
await sleep(300)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await sleep(3000)
const created = existsSync(join(wsRoot, 'newfile.ino'))
console.log('newfile on disk:', created)
const after = await evalJs("(() => { const d = document.querySelector('[role=complementary]'); if (!d) return 'no-dock'; const t = d.innerText; return JSON.stringify({ newfileInTree: t.includes('newfile.ino'), fileList: t.slice(0, 220) }) })()")
console.log('tree after create:', after)
await shot('debug-workspace-filetree-final.png')
console.log('errors:', JSON.stringify(errors.slice(0, 3)))
ws.close(); browser.kill()
