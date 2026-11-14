/**
 * Canvas hub host behavior over a real web server: snapshot storage, state and
 * health reads, op queue delivery through long polls, acknowledgement
 * round-trips, the disconnection age window, tool failures, and route refusals.
 * The browser half is not involved; the test plays it over HTTP.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as VelAgent from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
})

/** One booted composition serving the canvas routes. */
interface Booted {
  readonly context: Context
  readonly origin: string
}

/** Boot the web server, prompt registry, tool registry, and the canvas host half. */
async function boot(): Promise<Booted> {
  const context = new Context()
  contexts.push(context)
  await context.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await context.plugin(SystemPrompt, {})
  await context.plugin(Tools)
  await context.plugin(VelAgent)
  const port = context.webServer.port
  if (port === undefined) throw new Error('the test web server did not bind')
  return { context, origin: `http://127.0.0.1:${String(port)}` }
}

/** POST one JSON body. */
async function postJson(origin: string, path: string, body: unknown): Promise<Response> {
  return await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** GET one route. */
async function getJson(origin: string, path: string): Promise<Response> {
  return await fetch(`${origin}${path}`)
}

/** Read a JSON response body as its known test shape. */
async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

/** A workspace snapshot with the given revision and entries. */
function workspace(
  revision: number,
  entries: { boards?: unknown[]; components?: unknown[]; wires?: unknown[] } = {},
): unknown {
  return {
    revision,
    name: 'Demo circuit',
    boards: entries.boards ?? [],
    components: entries.components ?? [],
    wires: entries.wires ?? [],
  }
}

/** Post one workspace snapshot for a session. */
async function snapshot(
  origin: string,
  sessionId: string | undefined,
  revision: number,
  value: unknown = workspace(revision),
): Promise<void> {
  const response = await postJson(origin, '/velagent/canvas/snapshot', {
    ...sessionId === undefined ? {} : { sessionId },
    revision,
    workspace: value,
  })
  expect(response.status).toBe(204)
}

/** The execution context fields the canvas tools read. */
function execution(sessionId: string) {
  return { agent: { session: { id: sessionId } }, signal: new AbortController().signal } as never
}

/** Resolve one registered tool definition. */
function tool(context: Context, name: string) {
  const definition = context.tools.get(name)
  if (definition === undefined) throw new Error(`tool ${name} is not registered`)
  return definition
}

/** Run one canvas tool and return its canonical value. */
async function runTool(
  context: Context,
  name: string,
  args: Record<string, unknown>,
  sessionId = 'session-a',
): Promise<Record<string, unknown>> {
  const value = await tool(context, name).execute(args, execution(sessionId))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`tool ${name} returned a non-object value`)
  }
  return value as Record<string, unknown>
}

/** One command delivered by a long poll. */
interface DeliveredCommand {
  readonly id: string
  readonly command: { readonly op?: string; readonly [key: string]: unknown }
}

/** One `GET ops` response body. */
interface OpsBody {
  readonly cursor: number
  readonly ops: DeliveredCommand[]
}

/** Poll one session's queued ops with the shortest hold the route accepts. */
async function pollOps(origin: string, sessionId: string): Promise<OpsBody> {
  return await readJson<OpsBody>(
    await getJson(origin, `/velagent/canvas/ops?sessionId=${sessionId}&wait=1`),
  )
}

/** Acknowledge one delivered operation. */
async function acknowledge(
  origin: string,
  sessionId: string,
  op: DeliveredCommand,
  body: { ok: boolean; result?: unknown; error?: string },
): Promise<void> {
  const response = await postJson(origin, '/velagent/canvas/ack', {
    sessionId,
    opId: op.id,
    ...body,
  })
  expect(response.status).toBe(204)
}

describe('VelAgent canvas hub', () => {
  it('stores the latest snapshot per session and serves state and health', async () => {
    const { origin } = await boot()
    const stored = workspace(4, { boards: [{ id: 'board-1', kind: 'breadboard', x: 0, y: 0, rotation: 0 }] })
    await snapshot(origin, 'session-a', 4, stored)

    const state = await readJson<{ connected: boolean; revision: number; workspace: unknown }>(
      await getJson(origin, '/velagent/canvas/state?sessionId=session-a'),
    )
    expect(state).toEqual({ connected: true, revision: 4, workspace: stored })

    const health = await readJson<{ ok: boolean; sessions: Array<{ sessionId: string; revision: number; ageMs: number }> }>(
      await getJson(origin, '/velagent/canvas/health'),
    )
    expect(health.ok).toBe(true)
    expect(health.sessions).toHaveLength(1)
    expect(health.sessions[0]).toMatchObject({ sessionId: 'session-a', revision: 4 })
    expect(health.sessions[0]?.ageMs).toBeGreaterThanOrEqual(0)
  })

  it('reports a disconnected state before any canvas pushes a snapshot', async () => {
    const { origin } = await boot()
    const state = await readJson<{ connected: boolean; revision: number; workspace: unknown }>(
      await getJson(origin, '/velagent/canvas/state?sessionId=session-missing'),
    )
    expect(state).toEqual({ connected: false, revision: 0, workspace: null })
    const health = await readJson<{ ok: boolean; sessions: unknown[] }>(await getJson(origin, '/velagent/canvas/health'))
    expect(health).toEqual({ ok: true, sessions: [] })
  })

  it('delivers a queued command to a long poll and resolves the tool call on ack', async () => {
    const { context, origin } = await boot()
    const stored = workspace(2)
    await snapshot(origin, 'session-a', 2, stored)

    // Start the browser's long poll first: it must park until the tool enqueues.
    const poll = getJson(origin, '/velagent/canvas/ops?sessionId=session-a&wait=5000')
    await new Promise(resolve => setTimeout(resolve, 100))

    const pending = tool(context, 'velagent_place_component').execute(
      { metadata_id: 'led', x: 12, y: 34 },
      execution('session-a'),
    )

    const body = await readJson<OpsBody>(await poll)
    expect(body.ops).toHaveLength(1)
    const delivered = body.ops[0]
    if (delivered === undefined) throw new Error('the long poll delivered no command')
    expect(delivered.command).toMatchObject({ op: 'place_component', metadata_id: 'led', x: 12, y: 34 })
    expect(typeof delivered.id).toBe('string')
    expect(body.cursor).toBeGreaterThan(0)

    await acknowledge(origin, 'session-a', delivered, { ok: true, result: { id: 'component-1' }, })
    await expect(pending).resolves.toEqual({ ok: true, id: 'component-1' })

    // The delivered command is not redelivered.
    expect((await pollOps(origin, 'session-a')).ops).toEqual([])
  })

  it('assigns monotonic op ids and treats duplicate acknowledgements as idempotent', async () => {
    const { context, origin } = await boot()
    await snapshot(origin, 'session-a', 1)

    const first = runTool(context, 'velagent_remove_component', { id: 'component-1' })
    const firstPoll = await pollOps(origin, 'session-a')
    const firstCommand = firstPoll.ops[0]
    if (firstCommand === undefined) throw new Error('the first command was not delivered')

    await acknowledge(origin, 'session-a', firstCommand, { ok: true, result: { ok: true } })
    await acknowledge(origin, 'session-a', firstCommand, { ok: true, result: { ok: true } })
    await expect(first).resolves.toEqual({ ok: true })

    const second = runTool(context, 'velagent_remove_wire', { id: 'wire-1' })
    const secondPoll = await pollOps(origin, 'session-a')
    const secondCommand = secondPoll.ops[0]
    if (secondCommand === undefined) throw new Error('the second command was not delivered')
    expect(secondCommand.command).toMatchObject({ op: 'remove_wire', id: 'wire-1' })
    expect(secondCommand.id).not.toBe(firstCommand.id)
    await acknowledge(origin, 'session-a', secondCommand, { ok: true, result: { ok: true } })
    await expect(second).resolves.toEqual({ ok: true })
  })

  it('returns the browser rejection to the model as a structured failure', async () => {
    const { context, origin } = await boot()
    await snapshot(origin, 'session-a', 1)

    const pending = runTool(context, 'velagent_place_board', { kind: 'breadboard' })
    const body = await pollOps(origin, 'session-a')
    const delivered = body.ops[0]
    if (delivered === undefined) throw new Error('the command was not delivered')
    await acknowledge(origin, 'session-a', delivered, { ok: false, error: 'unknown board kind' })
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'unknown board kind' })
  })

  it('passes the validator result through unchanged', async () => {
    const { context, origin } = await boot()
    await snapshot(origin, 'session-a', 1)

    const pending = runTool(context, 'velagent_validate', {})
    const body = await pollOps(origin, 'session-a')
    const delivered = body.ops[0]
    if (delivered === undefined) throw new Error('the validate command was not delivered')
    expect(delivered.command).toMatchObject({ op: 'validate' })
    const issues = { errors: [{ code: 'SHORT_RISK', message: 'power and ground are connected' }], warnings: [] }
    await acknowledge(origin, 'session-a', delivered, { ok: true, result: { ok: false, ...issues } })
    await expect(pending).resolves.toEqual({ ok: false, ...issues })
  })

  it('reports canvas_not_connected when no canvas is connected', async () => {
    const { context } = await boot()
    await expect(tool(context, 'velagent_read_circuit').execute({}, execution('session-a')))
      .resolves.toMatchObject({ ok: false, error: 'canvas_not_connected' })
    await expect(tool(context, 'velagent_clear').execute({}, execution('session-a')))
      .resolves.toMatchObject({ ok: false, error: 'canvas_not_connected' })
  })

  it('ages a canvas out of the connection window', async () => {
    const { context, origin } = await boot()
    await snapshot(origin, 'session-a', 1)
    const live = await readJson<{ connected: boolean }>(await getJson(origin, '/velagent/canvas/state?sessionId=session-a'))
    expect(live.connected).toBe(true)

    // Only Date is faked: the HTTP server and its timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() + 20_000))

    const stale = await readJson<{ connected: boolean }>(await getJson(origin, '/velagent/canvas/state?sessionId=session-a'))
    expect(stale.connected).toBe(false)
    const health = await readJson<{ sessions: Array<{ ageMs: number }> }>(await getJson(origin, '/velagent/canvas/health'))
    expect(health.sessions[0]?.ageMs).toBeGreaterThan(15_000)
    await expect(tool(context, 'velagent_read_circuit').execute({}, execution('session-a')))
      .resolves.toMatchObject({ ok: false, error: 'canvas_not_connected' })
  })

  it('keeps sessions apart', async () => {
    const { context, origin } = await boot()
    await snapshot(origin, 'session-a', 1)
    await snapshot(origin, 'session-b', 2)

    const pending = runTool(context, 'velagent_remove_component', { id: 'component-1' }, 'session-a')
    expect((await pollOps(origin, 'session-b')).ops).toEqual([])
    const own = await pollOps(origin, 'session-a')
    expect(own.ops).toHaveLength(1)
    const delivered = own.ops[0]
    if (delivered === undefined) throw new Error('the session command was not delivered')
    await acknowledge(origin, 'session-a', delivered, { ok: true, result: { ok: true } })
    await expect(pending).resolves.toEqual({ ok: true })

    // A tool call from a third session does not pick an arbitrary canvas.
    await expect(tool(context, 'velagent_clear').execute({}, execution('session-c')))
      .resolves.toMatchObject({ ok: false, error: 'canvas_not_connected' })
  })

  it('reads the circuit compactly by default and fully on request', async () => {
    const { context, origin } = await boot()
    await snapshot(origin, 'session-a', 7, workspace(7, {
      boards: [{ id: 'board-1', kind: 'breadboard', x: 0, y: 0, rotation: 0 }],
      components: [{ id: 'component-1', metadata_id: 'led', x: 3, y: 4, rotation: 0, properties: { color: 'red' } }],
      wires: [{ id: 'wire-1', from: { owner_id: 'board-1', pin: 'gnd' }, to: { owner_id: 'component-1', pin: 'C' }, color: 'black' }],
    }))

    const compact = await runTool(context, 'velagent_read_circuit', {})
    expect(compact).toMatchObject({ ok: true, revision: 7 })
    expect(compact['summary']).toEqual({ boards: 1, components: 1, wires: 1 })
    const compactComponents = compact['components'] as Array<Record<string, unknown>>
    expect(compactComponents).toHaveLength(1)
    expect(compactComponents[0]).not.toHaveProperty('properties')
    expect(compactComponents[0]).toMatchObject({ id: 'component-1', metadata_id: 'led' })
    expect(compact['wires']).toHaveLength(1)

    const full = await runTool(context, 'velagent_read_circuit', { full: true })
    const fullComponents = full['components'] as Array<Record<string, unknown>>
    expect(fullComponents[0]).toMatchObject({ properties: { color: 'red' } })
  })

  it('refuses malformed requests without corrupting canvas state', async () => {
    const { origin } = await boot()
    await snapshot(origin, 'session-a', 1)

    const badJson = await fetch(`${origin}/velagent/canvas/snapshot`, { method: 'POST', body: 'not json' })
    expect(badJson.status).toBe(400)

    const badAck = await postJson(origin, '/velagent/canvas/ack', { ok: true })
    expect(badAck.status).toBe(400)

    const oversized = await fetch(`${origin}/velagent/canvas/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 1, workspace: {}, padding: 'x'.repeat(4 * 1024 * 1024 + 32) }),
    })
    expect(oversized.status).toBe(413)

    const wrongMethod = await postJson(origin, '/velagent/canvas/ops', {})
    expect(wrongMethod.status).toBe(405)

    const health = await readJson<{ sessions: Array<{ revision: number }> }>(await getJson(origin, '/velagent/canvas/health'))
    expect(health.sessions[0]?.revision).toBe(1)

    const unknown = await getJson(origin, '/velagent/canvas/unknown')
    expect(unknown.status).toBe(404)
  })
})
