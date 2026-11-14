/**
 * Browser-side VelAgent workbench bridge.
 *
 * The dock owns one bridge instance: it loads `/velxio-ui.css` and
 * `/velagent-embed.js` once per page, mounts the original VelAgent workbench
 * into the dock (or the bare circuit canvas when the page serves a pre-v3
 * embed), pushes workspace snapshots to the harness host, and long-polls the
 * host's command queue. Model tool commands (`code_get`, `code_set`,
 * `timeline_play`, `timeline_stop`, `export_project`) run through the embed's
 * `executeCommand` untouched. Wire details follow
 * `VelAgent/docs/canvas-bridge-contract.md` (§1, §5).
 */

import type { WorkspaceProvider } from './workspaceBridge.ts'

/** Lifecycle status of one attached workbench bridge, shown by the dock's status indicator. */
export type CanvasSyncStatus = 'connecting' | 'connected' | 'closed' | 'error'

/** Dock features advertised by the loaded embed build. */
export interface CanvasCapabilities {
  /** `mountWorkspace` is available, so the dock can host the full workbench (embed v3). */
  readonly workspace: boolean
  /** `mountEditor` is available (embed v2 or newer). */
  readonly editor: boolean
  /** Behaviour timelines can be played (embed v2 or newer). */
  readonly timeline: boolean
  /** The workspace can be exported as a `.vlx` download (embed v2 or newer). */
  readonly export: boolean
}

/** Every dock feature off: the state before the embed loads and after the dock closes. */
export const NO_CAPABILITIES: CanvasCapabilities = {
  workspace: false, editor: false, timeline: false, export: false,
}

/** Bridge state published to the dock; `error` carries the technical cause, never display copy. */
export interface CanvasSyncState {
  readonly status: CanvasSyncStatus
  /** Technical failure detail; present only while {@link CanvasSyncState.status} is `'error'`. */
  readonly error?: string
  /** Embed contract generation installed by the page; absent before the embed script runs. */
  readonly embedVersion?: number
  /** Features the loaded embed build supports; all off until it loads. */
  readonly capabilities: CanvasCapabilities
}

/** One board placed on the canvas. */
export interface CanvasBoard {
  readonly id: string
  readonly kind: string
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly name?: string
}

/** One component placed on the canvas. */
export interface CanvasComponent {
  readonly id: string
  readonly metadata_id: string
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly properties: Readonly<Record<string, unknown>>
}

/** One wire between two component pins. */
export interface CanvasWire {
  readonly id: string
  readonly from: { readonly owner_id: string; readonly pin: string }
  readonly to: { readonly owner_id: string; readonly pin: string }
  readonly color: string
  readonly signal?: string
}

/** Canvas workspace snapshot as exchanged with the host (contract §1). */
export interface CanvasWorkspaceSnapshot {
  readonly revision: number
  readonly name: string
  readonly boards: readonly CanvasBoard[]
  readonly components: readonly CanvasComponent[]
  readonly wires: readonly CanvasWire[]
}

/** One canvas command, opaque to this bridge: its `op` discriminant and members belong to the embed's command union. */
export type CanvasCommand = Readonly<Record<string, unknown>>

/** One time step of a behaviour timeline (contract §1). */
export interface TimelineStep {
  readonly t: number
  readonly leds?: Readonly<Record<string, boolean>>
  readonly serial?: string
  readonly note?: string
}

/** Behaviour playbook accepted by `playTimeline` (contract §1). */
export interface TimelinePlaybook {
  readonly timeline: readonly TimelineStep[]
  readonly explain?: string
  readonly warnings?: readonly string[]
}

/** One code file the embed editor exposes (contract §1). */
export interface VelAgentCodeFile {
  readonly name: string
  readonly content: string
}

/** Editor contents reported by the embed (contract §1). */
export interface VelAgentCode {
  readonly active: string | null
  readonly files: readonly VelAgentCodeFile[]
}

/** Options for the workbench mount (contract §1). */
export interface VelAgentWorkspaceOptions {
  /** Hand the workbench's AI run to the host plugin; omitted outside a Session so its local rule runs instead. */
  readonly onAiRun?: (() => void) | undefined
  /** File bridge to the Session workspace; omitted outside a Session so the workbench keeps its built-in file tree. */
  readonly workspace?: WorkspaceProvider | undefined
}

/** Embed API installed by `/velagent-embed.js` (contract §1). */
export interface VelAgentEmbedApi {
  /** Contract generation; absent on embed builds older than the versioned contract. */
  readonly version?: number
  /** Mount the original VelAgent workbench; absent on pre-v3 embed builds. */
  mountWorkspace?(element: HTMLElement, options?: VelAgentWorkspaceOptions): () => void
  /** Mount the circuit canvas; returns the unmount function. */
  mount(element: HTMLElement): () => void
  /** Mount the code editor; absent on pre-v2 embed builds. */
  mountEditor?(element: HTMLElement): () => void
  /** Current workspace snapshot. */
  getState(): CanvasWorkspaceSnapshot
  /** Execute one command; resolves with its result and the post-execution snapshot. */
  executeCommand(command: CanvasCommand): Promise<{ readonly result: unknown; readonly workspace: CanvasWorkspaceSnapshot }>
  /** Subscribe to workspace changes; returns the unsubscribe function. */
  subscribe(listener: (state: CanvasWorkspaceSnapshot) => void): () => void
  /** Current editor code; absent on pre-v2 embed builds. */
  getCode?(): VelAgentCode
  /** Write editor code; absent on pre-v2 embed builds. */
  setCode?(update: { readonly name?: string; readonly content: string }): Promise<{ readonly name: string }>
  /** Play one behaviour timeline; absent on pre-v2 embed builds. */
  playTimeline?(playbook: TimelinePlaybook): { readonly stop: () => void }
  /** Download the workspace as a `.vlx` project; absent on pre-v2 embed builds. */
  exportProject?(options?: { readonly name?: string }): { readonly name: string }
}

declare global {
  interface Window {
    /** Workbench embed entry point, installed once the embed script runs. */
    VelAgentEmbed?: VelAgentEmbedApi
  }
}

/** Path of the canvas stylesheet served by the workbench host plugin. */
const CANVAS_STYLESHEET_PATH = '/velagent-assets/velxio-ui.css'
/** Path of the embeddable workbench bundle served by the workbench host plugin. */
const EMBED_SCRIPT_PATH = '/velagent-assets/velagent-embed.js'

/** Host routes owned by the canvas hub (contract §2). */
const SNAPSHOT_PATH = '/velagent/canvas/snapshot'
const OPS_PATH = '/velagent/canvas/ops'
const ACK_PATH = '/velagent/canvas/ack'

/** Quiet window that folds a burst of workspace edits into one snapshot POST. */
const SNAPSHOT_DEBOUNCE_MS = 120
/** Host-side long-poll budget for one command request. */
const OPS_WAIT_MS = 20_000
/** Delay before retrying a failed request; the loops keep running across outages. */
const RETRY_DELAY_MS = 1_000
/** How long the embed script may take to install {@link Window.VelAgentEmbed}. */
const EMBED_LOAD_TIMEOUT_MS = 10_000
/** Load/mount attempts before the dock asks the human to reopen it. */
const LOAD_ATTEMPTS = 3
/** Embed contract generation whose workbench mount this dock uses. */
const SUPPORTED_EMBED_VERSION = 3
/** Older generation that still mounts the circuit canvas; the dock falls back to it and says so. */
const FALLBACK_EMBED_VERSION = 2
/** Oldest generation that supplies a canvas mount. */
const LEGACY_EMBED_VERSION = 1

/** One command delivered by the host's long poll. */
interface CanvasOp {
  readonly id: string
  readonly command: CanvasCommand
}

/** Host reply to one long poll (contract §2). */
interface CanvasOpsResponse {
  readonly cursor: number
  readonly ops: readonly CanvasOp[]
}

/** POST body for one workspace snapshot (contract §2). */
interface SnapshotBody {
  sessionId?: string
  revision: number
  workspace: CanvasWorkspaceSnapshot
}

/** POST body for one command acknowledgement (contract §2). */
interface AckBody {
  sessionId?: string
  opId: string
  ok: boolean
  result?: unknown
  error?: string
  workspace?: CanvasWorkspaceSnapshot
}

/** Options for {@link createCanvasSync}. */
export interface CanvasSyncOptions {
  /** Session owning the workbench; omitted lets the host address its single connected embed. */
  readonly sessionId?: string
}

/** Options for {@link CanvasBridge.attach}. */
export interface CanvasAttachOptions {
  /** Hand the workbench's AI run to the Harness model; omitted outside a Session so the workbench keeps its local rule. */
  readonly onAiRun?: (() => void) | undefined
  /** File bridge to the Session workspace; omitted outside a Session so the workbench keeps its built-in file tree. */
  readonly workspace?: WorkspaceProvider | undefined
}

/** One dock's workbench bridge. */
export interface CanvasBridge {
  /** Load and mount the workbench (or the bare canvas on a pre-v3 embed), then start host synchronization. */
  attach(container: HTMLElement, options?: CanvasAttachOptions): void
  /** Stop synchronization and unmount the embed content; idempotent. */
  dispose(): void
  /** Current bridge state. */
  getState(): CanvasSyncState
  /** Subscribe to bridge-state changes; returns the unsubscribe function. */
  subscribeState(listener: (state: CanvasSyncState) => void): () => void
}

/** Page-scoped embed loader; the script installs one global API, so it loads once. */
let embedLoader: Promise<VelAgentEmbedApi> | undefined

/**
 * Load the workbench embed script once per page.
 * @returns the installed embed API.
 */
function loadEmbed(): Promise<VelAgentEmbedApi> {
  const pending = embedLoader
  if (pending !== undefined) return pending
  const loading = loadEmbedOnce().catch((error: unknown) => {
    // A failed load is retryable from the next dock open.
    embedLoader = undefined
    throw error
  })
  embedLoader = loading
  return loading
}

/**
 * Insert the canvas stylesheet (idempotent) and wait for the embed script.
 * @returns the installed embed API.
 */
async function loadEmbedOnce(): Promise<VelAgentEmbedApi> {
  ensureCanvasStylesheet()
  const installed = window.VelAgentEmbed
  const api = installed ?? await waitForEmbedScript()
  const version = api.version
  if (version !== undefined && (version < LEGACY_EMBED_VERSION || version > SUPPORTED_EMBED_VERSION)) {
    throw new Error(`unsupported VelAgentEmbed version ${String(version)} (supported ${LEGACY_EMBED_VERSION}–${SUPPORTED_EMBED_VERSION})`)
  }
  return api
}

/**
 * Read the dock features one loaded embed build advertises.
 * @param api - installed embed API.
 * @returns the capability flags; a pre-v3 build cannot host the workbench.
 */
function capabilitiesOf(api: VelAgentEmbedApi): CanvasCapabilities {
  const generation = api.version ?? 0
  return {
    workspace: generation >= SUPPORTED_EMBED_VERSION && typeof api.mountWorkspace === 'function',
    editor: generation >= FALLBACK_EMBED_VERSION && typeof api.mountEditor === 'function',
    timeline: generation >= FALLBACK_EMBED_VERSION && typeof api.playTimeline === 'function',
    export: generation >= FALLBACK_EMBED_VERSION && typeof api.exportProject === 'function',
  }
}

/** Add the canvas stylesheet tag unless an earlier dock already did. */
function ensureCanvasStylesheet(): void {
  if (document.querySelector('link[data-velagent-css]') !== null) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = CANVAS_STYLESHEET_PATH
  link.dataset.velagentCss = '1'
  document.head.append(link)
}

/**
 * Insert the embed script (or observe the existing tag) and resolve once it
 * installs {@link Window.VelAgentEmbed}.
 * @returns the installed embed API.
 */
function waitForEmbedScript(): Promise<VelAgentEmbedApi> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-velagent-embed]')
    const script = existing ?? document.createElement('script')
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (error !== undefined) {
        reject(error)
        return
      }
      const api = window.VelAgentEmbed
      if (api === undefined) {
        reject(new Error(`embed script did not install window.VelAgentEmbed (${EMBED_SCRIPT_PATH})`))
        return
      }
      resolve(api)
    }
    const onLoad = (): void => { finish() }
    const onError = (): void => {
      finish(new Error(`embed script failed to load (${EMBED_SCRIPT_PATH})`))
    }
    timer = setTimeout(() => {
      finish(new Error(`embed script timed out (${EMBED_SCRIPT_PATH})`))
    }, EMBED_LOAD_TIMEOUT_MS)
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    if (existing === null) {
      script.src = EMBED_SCRIPT_PATH
      script.dataset.velagentEmbed = '1'
      document.body.append(script)
    }
  })
}

/** Render one thrown value as a technical message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Web-platform delay with no cancellation; the loops check disposal after waking. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds) })
}

/**
 * POST one JSON body to a canvas hub route.
 * @param path - route path on the current origin.
 * @param body - JSON-serializable request body.
 * @param signal - abort signal of the owning bridge.
 */
async function postJson(path: string, body: unknown, signal: AbortSignal): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`)
}

/**
 * Validate and narrow one host long-poll response.
 * @param body - parsed response body.
 * @returns the typed response.
 */
function parseOpsResponse(body: unknown): CanvasOpsResponse {
  if (typeof body !== 'object' || body === null) throw new Error('canvas ops response is not an object')
  const record = body as { cursor?: unknown; ops?: unknown }
  if (typeof record.cursor !== 'number' || !Number.isFinite(record.cursor)) {
    throw new Error('canvas ops response carries no numeric cursor')
  }
  if (!Array.isArray(record.ops)) throw new Error('canvas ops response carries no ops array')
  const ops = record.ops.map(parseOp)
  return { cursor: record.cursor, ops }
}

/**
 * Validate and narrow one delivered command.
 * @param value - one entry of the ops array.
 * @returns the typed command envelope.
 */
function parseOp(value: unknown): CanvasOp {
  if (typeof value !== 'object' || value === null) throw new Error('canvas op is not an object')
  const record = value as { id?: unknown; command?: unknown }
  if (typeof record.id !== 'string' || record.id === '') throw new Error('canvas op carries no id')
  const command = record.command
  if (typeof command !== 'object' || command === null || Array.isArray(command)) {
    throw new Error(`canvas op ${record.id} carries no command object`)
  }
  return { id: record.id, command: command as CanvasCommand }
}

/** One dock's bridge implementation. */
class CanvasBridgeImpl implements CanvasBridge {
  private readonly sessionId: string | undefined
  private readonly listeners = new Set<(state: CanvasSyncState) => void>()
  private state: CanvasSyncState = { status: 'closed', capabilities: NO_CAPABILITIES }
  private container: HTMLElement | undefined
  private onAiRun: (() => void) | undefined
  private workspace: WorkspaceProvider | undefined
  private api: VelAgentEmbedApi | undefined
  private unmount: (() => void) | undefined
  private unsubscribe: (() => void) | undefined
  private controller: AbortController | undefined
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined
  private loadRetryTimer: ReturnType<typeof setTimeout> | undefined
  private pageCleanup: (() => void) | undefined
  private latest: CanvasWorkspaceSnapshot | undefined
  private sentRevision: number | undefined
  private cursor = 0
  private loadAttempts = 0
  private polling = false
  private disposed = false

  constructor(sessionId: string | undefined) {
    this.sessionId = sessionId
  }

  attach(container: HTMLElement, options: CanvasAttachOptions = {}): void {
    if (this.disposed || this.container !== undefined) return
    this.container = container
    this.onAiRun = options.onAiRun
    this.workspace = options.workspace
    this.controller = new AbortController()
    this.setStatus('connecting')
    this.pageCleanup = () => { this.dispose() }
    window.addEventListener('pagehide', this.pageCleanup)
    void this.mount(container)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pageCleanup !== undefined) {
      window.removeEventListener('pagehide', this.pageCleanup)
      this.pageCleanup = undefined
    }
    this.controller?.abort()
    this.controller = undefined
    if (this.snapshotTimer !== undefined) {
      clearTimeout(this.snapshotTimer)
      this.snapshotTimer = undefined
    }
    if (this.loadRetryTimer !== undefined) {
      clearTimeout(this.loadRetryTimer)
      this.loadRetryTimer = undefined
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const unmount = this.unmount
    this.unmount = undefined
    this.api = undefined
    this.container = undefined
    this.onAiRun = undefined
    this.workspace = undefined
    this.latest = undefined
    this.setState({ status: 'closed', capabilities: NO_CAPABILITIES })
    this.listeners.clear()
    if (unmount !== undefined) {
      try {
        unmount()
      } catch {
        // The embed unmount is best-effort once the dock is gone.
      }
    }
  }

  getState(): CanvasSyncState {
    return this.state
  }

  subscribeState(listener: (state: CanvasSyncState) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load, mount, and subscribe the embed content, then start the command loop.
   * @param container - dock element owning the embed content.
   */
  private async mount(container: HTMLElement): Promise<void> {
    try {
      const api = this.api ?? await loadEmbed()
      if (this.disposed) return
      this.api = api
      const capabilities = capabilitiesOf(api)
      this.setState({
        status: this.state.status,
        capabilities,
        ...(api.version === undefined ? {} : { embedVersion: api.version }),
        ...(this.state.error === undefined ? {} : { error: this.state.error }),
      })
      if (this.unmount === undefined) this.unmount = this.mountEmbed(api, container, capabilities.workspace)
      if (this.unsubscribe === undefined) {
        this.unsubscribe = api.subscribe((snapshot) => { this.onSnapshot(snapshot) })
      }
      this.onSnapshot(api.getState())
      if (!this.polling) {
        this.polling = true
        void this.pollOps()
      }
    } catch (error) {
      if (this.disposed) return
      this.setStatus('error', messageOf(error))
      this.scheduleLoadRetry()
    }
  }

  /**
   * Mount the full workbench when the embed provides it, otherwise the circuit canvas.
   * @param api - installed embed API.
   * @param container - dock element owning the embed content.
   * @param workspaceSupported - whether the loaded build advertises `mountWorkspace`.
   * @returns the unmount function.
   */
  private mountEmbed(api: VelAgentEmbedApi, container: HTMLElement, workspaceSupported: boolean): () => void {
    const mountWorkspace = api.mountWorkspace
    if (!workspaceSupported || mountWorkspace === undefined) return api.mount(container)
    const options: VelAgentWorkspaceOptions = {
      ...(this.onAiRun === undefined ? {} : { onAiRun: this.onAiRun }),
      ...(this.workspace === undefined ? {} : { workspace: this.workspace }),
    }
    return mountWorkspace.call(api, container, options)
  }

  /** Retry a failed load/mount with the fixed retry delay, up to the attempt cap. */
  private scheduleLoadRetry(): void {
    if (this.disposed || this.loadRetryTimer !== undefined || this.loadAttempts >= LOAD_ATTEMPTS) return
    this.loadAttempts += 1
    this.loadRetryTimer = setTimeout(() => {
      this.loadRetryTimer = undefined
      const container = this.container
      if (this.disposed || container === undefined) return
      void this.mount(container)
    }, RETRY_DELAY_MS)
  }

  /** Fold one workspace change into the pending snapshot push. */
  private onSnapshot(snapshot: CanvasWorkspaceSnapshot): void {
    if (this.disposed) return
    this.latest = snapshot
    this.scheduleSnapshot(SNAPSHOT_DEBOUNCE_MS)
  }

  /**
   * Schedule one snapshot push; an already pending push keeps the newer snapshot.
   * @param milliseconds - delay before the push.
   */
  private scheduleSnapshot(milliseconds: number): void {
    if (this.disposed || this.snapshotTimer !== undefined) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined
      void this.pushSnapshot()
    }, milliseconds)
  }

  /** Push the latest snapshot to the host, retrying on failure until a later edit supersedes it. */
  private async pushSnapshot(): Promise<void> {
    const workspace = this.latest
    if (this.disposed || workspace === undefined) return
    if (workspace.revision === this.sentRevision) return
    const body: SnapshotBody = { ...this.sessionField(), revision: workspace.revision, workspace }
    try {
      await postJson(SNAPSHOT_PATH, body, this.signal())
      this.sentRevision = workspace.revision
      this.setStatus('connected')
    } catch (error) {
      if (this.disposed) return
      this.setStatus('error', messageOf(error))
      this.scheduleSnapshot(RETRY_DELAY_MS)
      return
    }
    if (this.latest !== undefined && this.latest.revision !== this.sentRevision) {
      this.scheduleSnapshot(SNAPSHOT_DEBOUNCE_MS)
    }
  }

  /** Long-poll the host's command queue; transport failures retry instead of ending the loop. */
  private async pollOps(): Promise<void> {
    while (!this.disposed) {
      try {
        const response = await this.requestOps()
        if (this.disposed) return
        if (this.state.status !== 'connected') {
          // The host may have restarted between polls; resend the current
          // workspace so its hub never keeps a stale revision.
          this.sentRevision = undefined
          this.scheduleSnapshot(0)
        }
        this.setStatus('connected')
        this.cursor = response.cursor
        for (const op of response.ops) {
          if (this.disposed) return
          await this.runOp(op)
        }
      } catch (error) {
        if (this.disposed) return
        // The contract restarts a reconnected client at cursor zero; the host
        // keeps its acked-op ledger, so re-delivery skips executed commands.
        this.cursor = 0
        this.setStatus('error', messageOf(error))
        await delay(RETRY_DELAY_MS)
      }
    }
  }

  /**
   * Request the next batch of commands.
   * @returns the host's cursor and delivered commands.
   */
  private async requestOps(): Promise<CanvasOpsResponse> {
    const params = new URLSearchParams({ cursor: String(this.cursor), wait: String(OPS_WAIT_MS) })
    if (this.sessionId !== undefined) params.set('sessionId', this.sessionId)
    const response = await fetch(`${OPS_PATH}?${params.toString()}`, {
      headers: { accept: 'application/json' },
      signal: this.signal(),
    })
    if (!response.ok) throw new Error(`${OPS_PATH} failed with HTTP ${response.status}`)
    const body: unknown = await response.json()
    return parseOpsResponse(body)
  }

  /**
   * Execute one delivered command on the embed and acknowledge it.
   * @param op - command envelope delivered by the host.
   */
  private async runOp(op: CanvasOp): Promise<void> {
    const api = this.api
    if (api === undefined) return
    let ack: AckBody
    try {
      const outcome = await api.executeCommand(op.command)
      this.latest = outcome.workspace
      this.scheduleSnapshot(SNAPSHOT_DEBOUNCE_MS)
      ack = { ...this.sessionField(), opId: op.id, ok: true, result: outcome.result, workspace: outcome.workspace }
    } catch (error) {
      ack = { ...this.sessionField(), opId: op.id, ok: false, error: messageOf(error) }
    }
    try {
      await postJson(ACK_PATH, ack, this.signal())
    } catch {
      // The snapshot push and the next poll own outage detection; the host
      // times the tool call out on its own if its ack never arrives.
    }
  }

  /** Session field shared by push and ack bodies; omitted when the dock has no Session. */
  private sessionField(): { sessionId?: string } {
    return this.sessionId === undefined ? {} : { sessionId: this.sessionId }
  }

  /** Abort signal shared by every request of this attachment. */
  private signal(): AbortSignal {
    this.controller ??= new AbortController()
    return this.controller.signal
  }

  /** Publish a new lifecycle status, retaining the loaded embed's generation and capabilities. */
  private setStatus(status: CanvasSyncStatus, error?: string): void {
    const current = this.state
    this.setState({
      status,
      capabilities: current.capabilities,
      ...(current.embedVersion === undefined ? {} : { embedVersion: current.embedVersion }),
      ...(error === undefined ? {} : { error }),
    })
  }

  /** Publish a new bridge state when any published field differs from the current one. */
  private setState(next: CanvasSyncState): void {
    const current = this.state
    if (current.status === next.status
      && current.error === next.error
      && current.embedVersion === next.embedVersion
      && current.capabilities.workspace === next.capabilities.workspace
      && current.capabilities.editor === next.capabilities.editor
      && current.capabilities.timeline === next.capabilities.timeline
      && current.capabilities.export === next.capabilities.export) return
    this.state = next
    for (const listener of this.listeners) listener(next)
  }
}

/**
 * Create the bridge for one dock panel.
 * @param options - session binding for the canvas hub routes.
 * @returns the dock bridge.
 */
export function createCanvasSync(options: CanvasSyncOptions = {}): CanvasBridge {
  return new CanvasBridgeImpl(options.sessionId)
}
