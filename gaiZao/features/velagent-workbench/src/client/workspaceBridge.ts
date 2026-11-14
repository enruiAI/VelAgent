/**
 * Browser-side workspace provider for the embedded VelAgent workbench.
 *
 * The workbench file tree reads and writes the Harness Session workspace through
 * the host's same-origin `/velagent/workspace/*` routes, so it shows the same
 * directory as the Harness sidebar. Wire details follow
 * `VelAgent/docs/canvas-bridge-contract.md` (§1, §2).
 */

/** One directory entry shown by the workbench file tree (contract §1). */
export interface WorkspaceEntry {
  readonly name: string
  readonly type: 'file' | 'directory'
  /** Byte length for files the host measured; absent for directories. */
  readonly bytes?: number
}

/** One directory listing rooted at the Session workspace (contract §1). */
export interface WorkspaceListing {
  /** Absolute workspace root path the host resolves the listing against. */
  readonly root: string
  /** Display name of the workspace root. */
  readonly name: string
  readonly entries: readonly WorkspaceEntry[]
}

/** One text file read from the Session workspace (contract §1). */
export interface WorkspaceFile {
  readonly text: string
  /** Host change token for the file; the workbench uses it to detect stale reads. */
  readonly version: string
}

/** Workspace file bridge between the embedded workbench and the Harness Session (contract §1). */
export interface WorkspaceProvider {
  /**
   * List one workspace directory.
   * @param path - workspace-relative directory path; omitted lists the root.
   * @returns the workspace root plus its entries.
   */
  list(path?: string): Promise<WorkspaceListing>
  /**
   * Read one workspace text file.
   * @param path - workspace-relative file path.
   * @returns the file text and its host version token.
   */
  read(path: string): Promise<WorkspaceFile>
  /**
   * Write one workspace text file.
   * @param path - workspace-relative file path.
   * @param content - full file text to write.
   * @returns the host version token after the write.
   */
  write(path: string, content: string): Promise<{ readonly version: string }>
  /**
   * Create one workspace directory.
   * @param path - workspace-relative directory path.
   */
  mkdir?(path: string): Promise<void>
  /**
   * Rename or move one workspace file or directory.
   * @param from - workspace-relative source path.
   * @param to - workspace-relative destination path.
   */
  rename?(from: string, to: string): Promise<void>
  /**
   * Remove one workspace file or directory.
   * @param path - workspace-relative path to remove.
   */
  remove?(path: string): Promise<void>
}

/** Route listing one workspace directory (contract §2). */
const LIST_ROUTE = '/velagent/workspace/list'
/** Route reading one workspace file (contract §2). */
const READ_ROUTE = '/velagent/workspace/read'
/** Route writing one workspace file (contract §2). */
const WRITE_ROUTE = '/velagent/workspace/write'
/** Route creating one workspace directory (contract §2). */
const MKDIR_ROUTE = '/velagent/workspace/mkdir'
/** Route renaming one workspace file or directory (contract §2). */
const RENAME_ROUTE = '/velagent/workspace/rename'
/** Route removing one workspace file or directory (contract §2). */
const DELETE_ROUTE = '/velagent/workspace/delete'

/** One parsed JSON object from a workspace route. */
type JsonRecord = Record<string, unknown>

/** Whether one value is a JSON object. */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Require one JSON object from a route response.
 * @param value - parsed response value.
 * @param label - field description used in the failure message.
 * @returns the object.
 */
function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} is not a JSON object`)
  return value
}

/**
 * Require one string field from a route response.
 * @param value - field value.
 * @param label - field description used in the failure message.
 * @returns the string.
 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`)
  return value
}

/**
 * Read one workspace route response, rejecting transport and business failures.
 * @param response - fetch response from a workspace route.
 * @param route - route path used in the failure message.
 * @returns the parsed JSON value.
 * @throws when the response is an HTTP failure or carries no JSON body.
 */
async function readJson(response: Response, route: string): Promise<unknown> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.error === 'string' ? `: ${body.error}` : ''
    throw new Error(`${route} failed with HTTP ${response.status}${detail}`)
  }
  return body
}

/**
 * Validate one directory listing response.
 * @param body - parsed route response.
 * @returns the listing handed to the workbench.
 */
function parseListing(body: unknown): WorkspaceListing {
  const record = requireRecord(body, 'workspace list response')
  const entries = record.entries
  if (!Array.isArray(entries)) throw new Error('workspace list response carries no entries array')
  return {
    root: requireString(record.root, 'workspace list root'),
    name: requireString(record.name, 'workspace list name'),
    entries: entries.map(parseEntry),
  }
}

/**
 * Validate one directory entry response item.
 * @param value - one entry of the listing.
 * @returns the typed entry.
 */
function parseEntry(value: unknown): WorkspaceEntry {
  const record = requireRecord(value, 'workspace entry')
  const name = requireString(record.name, 'workspace entry name')
  const type = record.type === 'file' || record.type === 'directory' ? record.type : undefined
  if (type === undefined) throw new Error(`workspace entry "${name}" is neither a file nor a directory`)
  return typeof record.bytes === 'number' && Number.isFinite(record.bytes)
    ? { name, type, bytes: record.bytes }
    : { name, type }
}

/**
 * Validate one file read response.
 * @param body - parsed route response.
 * @returns the file text and version token.
 */
function parseFile(body: unknown): WorkspaceFile {
  const record = requireRecord(body, 'workspace read response')
  return {
    text: requireString(record.text, 'workspace read text'),
    version: requireString(record.version, 'workspace read version'),
  }
}

/**
 * Validate one file write response.
 * @param body - parsed route response.
 * @returns the version token after the write.
 */
function parseWritten(body: unknown): { readonly version: string } {
  const record = requireRecord(body, 'workspace write response')
  return { version: requireString(record.version, 'workspace write version') }
}

/** Workspace provider bound to one Harness Session's workspace root. */
class HttpWorkspaceProvider implements WorkspaceProvider {
  private readonly sessionId: string

  /**
   * @param sessionId - Session whose workspace root the workbench reads and writes.
   */
  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  async list(path?: string): Promise<WorkspaceListing> {
    const params = new URLSearchParams({ sessionId: this.sessionId })
    if (path !== undefined && path !== '') params.set('path', path)
    const response = await fetch(`${LIST_ROUTE}?${params.toString()}`, {
      headers: { accept: 'application/json' },
    })
    return parseListing(await readJson(response, LIST_ROUTE))
  }

  async read(path: string): Promise<WorkspaceFile> {
    const params = new URLSearchParams({ sessionId: this.sessionId, path })
    const response = await fetch(`${READ_ROUTE}?${params.toString()}`, {
      headers: { accept: 'application/json' },
    })
    return parseFile(await readJson(response, READ_ROUTE))
  }

  async write(path: string, content: string): Promise<{ readonly version: string }> {
    const response = await fetch(WRITE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, path, content }),
    })
    return parseWritten(await readJson(response, WRITE_ROUTE))
  }

  async mkdir(path: string): Promise<void> {
    await this.postOperation(MKDIR_ROUTE, 'workspace mkdir response', { path })
  }

  async rename(from: string, to: string): Promise<void> {
    await this.postOperation(RENAME_ROUTE, 'workspace rename response', { from, to })
  }

  async remove(path: string): Promise<void> {
    await this.postOperation(DELETE_ROUTE, 'workspace delete response', { path })
  }

  /**
   * POST one file-tree operation for this Session.
   * @param route - workspace route path.
   * @param label - response description used in a malformed-body failure message.
   * @param fields - operation fields; the Session id is added.
   * @throws when the route fails or answers a non-object body.
   */
  private async postOperation(route: string, label: string, fields: Readonly<Record<string, string>>): Promise<void> {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sessionId: this.sessionId, ...fields }),
    })
    const body = requireRecord(await readJson(response, route), label)
    if (body.ok === false) {
      const detail = typeof body.error === 'string' ? `: ${body.error}` : ''
      throw new Error(`${route} failed${detail}`)
    }
  }
}

/**
 * Create the workspace file bridge for one dock Session.
 * @param sessionId - Session whose workspace root the workbench reads and writes.
 * @returns the provider handed to `embed.mountWorkspace` as `options.workspace`.
 */
export function createWorkspaceProvider(sessionId: string): WorkspaceProvider {
  return new HttpWorkspaceProvider(sessionId)
}
