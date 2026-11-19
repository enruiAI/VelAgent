#!/usr/bin/env node
/**
 * VelAgent launcher core: start this repository's dsh web (profile web, port 2021)
 * with an isolated DSH_HOME, capture the token URL and open the browser.
 *
 * The global 'velagent' command installed by gaiZao/scripts/install-velagent.ps1
 * imports this module through an absolute file URL.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 2021

/**
 * Whether something already listens on the VelAgent port.
 * @returns {Promise<boolean>} true when the port accepts a connection.
 */
function portListening() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT })
    socket.setTimeout(400)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Start VelAgent (or reopen the running instance) and print the token URL.
 * @param {string[]} [args] - forwarded launcher flags; --no-open skips the browser.
 * @returns {Promise<void>} resolves after the URL is known and printed.
 */
export async function launch(args = process.argv.slice(2)) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const appData = process.env.APPDATA || process.env.HOME || '.'
  const stateDir = join(appData, 'Enrui', 'VelAgent')
  const dshHome = join(stateDir, 'data', 'harness-home')
  const bin = join(repoRoot, 'apps', 'cli', 'lib', 'bin.js')
  const logFile = join(stateDir, 'web-server.log')
  const errFile = join(stateDir, 'web-server.err.log')
  const urlFile = join(stateDir, 'web-url.txt')
  const pluginPath = join(repoRoot, 'gaiZao', 'features', 'velagent-workbench')
  const noOpen = args.includes('--no-open')

  mkdirSync(stateDir, { recursive: true })
  if (!existsSync(bin)) {
    console.error('missing build output: ' + bin)
    console.error('run  pnpm install  and  pnpm build  in ' + repoRoot)
    process.exit(1)
  }

  if (await portListening()) {
    // Prefer the live URL in the server log: web-url.txt may be stale after a restart.
    let running = null
    if (existsSync(logFile)) {
      const logged = /dsh web: (http:\/\/\S+)/.exec(readFileSync(logFile, 'utf8'))
      running = logged ? logged[1] : null
    }
    if (running === null && existsSync(urlFile)) {
      const saved = readFileSync(urlFile, 'utf8').trim()
      running = saved.length > 0 ? saved : null
    }
    if (running !== null) {
      writeFileSync(urlFile, running)
      console.log('VelAgent already running: ' + running)
      if (!noOpen) spawn('cmd', ['/c', 'start', '', running], { detached: true, stdio: 'ignore' }).unref()
      return
    }
    console.log('VelAgent already running on port ' + PORT + ' (no recorded URL; open the page from the running instance)')
    return
  }

  const env = { ...process.env, DSH_HOME: dshHome, DSH_AGENTS_HOME: join(dshHome, 'agents'), DSH_CLIENT_TITLE: 'VelAgent' }
  if (!env.DEEPSEEK_API_KEY) {
    const keyFile = join(stateDir, 'api-key.txt')
    if (existsSync(keyFile)) env.DEEPSEEK_API_KEY = readFileSync(keyFile, 'utf8').trim()
  }

  const manifest = join(dshHome, 'profiles', 'web', 'package.json')
  let installed = false
  if (existsSync(manifest)) installed = readFileSync(manifest, 'utf8').includes('velagent-workbench')
  if (!installed) {
    console.log('installing velagent-workbench into dsh profile web ...')
    const added = spawn(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', pluginPath], { cwd: repoRoot, env, stdio: 'inherit' })
    const code = await new Promise((resolve) => added.on('exit', (value) => resolve(value ?? 1)))
    if (code !== 0) {
      console.error('plugin install failed')
      process.exit(1)
    }
  }

  console.log('starting VelAgent (dsh web, port ' + PORT + ') ...')
  const out = openSync(logFile, 'w')
  const err = openSync(errFile, 'w')
  const child = spawn(process.execPath, [bin, '--profile', 'web', '--port', String(PORT), '--no-open'], {
    cwd: repoRoot, env, detached: true, stdio: ['ignore', out, err],
  })
  child.unref()

  let url = null
  for (let i = 0; i < 180; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (existsSync(logFile)) {
      const match = /dsh web: (http:\/\/\S+)/.exec(readFileSync(logFile, 'utf8'))
      if (match) { url = match[1]; break }
    }
  }
  if (url === null) {
    console.error('no URL in ' + logFile + '; see ' + errFile)
    process.exit(1)
  }
  writeFileSync(urlFile, url)
  console.log('VelAgent started: ' + url)
  if (!noOpen) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
}
