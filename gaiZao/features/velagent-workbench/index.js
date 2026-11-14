// src/index.ts
import { createReadStream, statSync } from "node:fs";
import { mkdir, rename as renamePath, rmdir } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
var name = "ui-velagent";
var inject = ["tools", "webServer", "systemPrompt", "fs", "sessions"];
var ROUTE_ROOT = "/velagent/canvas";
var WORKSPACE_ROOT = "/velagent/workspace";
var MAX_BODY_BYTES = 4 * 1024 * 1024;
var MAX_POLL_MS = 25e3;
var DEFAULT_POLL_MS = 2e4;
var OP_TIMEOUT_MS = 3e4;
var CONNECTED_AGE_MS = 3e4;
var SESSION_IDLE_MS = 10 * 60 * 1e3;
var UNBOUND_SESSION = "@unbound";
var WORKSPACE_READ_MAX_BYTES = 1024 * 1024;
var WORKSPACE_WRITE_MAX_BYTES = 2 * 1024 * 1024;
var WORKSPACE_LIST_MAX_ENTRIES = 500;
var ASSET_ROOT = "/velagent-assets";
var UI_PUBLIC_ROOTS = ["/component-svgs", "/components", "/boards", "/fonts"];
var DEFAULT_UI_DIST = fileURLToPath(new URL("../velagent-ui/embed-dist/", import.meta.url));
var ASSET_CONTENT_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8"
};
function uiDistDir() {
  const override = process.env.VELAGENT_UI_DIR;
  return override !== void 0 && override.length > 0 ? resolve(override) : DEFAULT_UI_DIST;
}
function requestPathname(req) {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}
function serveUiAsset(reference, res) {
  const relative = reference.replace(/^\/+/, "");
  if (relative.length === 0) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const rootDir = uiDistDir();
  const target = resolve(rootDir, relative);
  const rootWithSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  if (target !== rootDir && !target.startsWith(rootWithSep)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  let info;
  try {
    info = statSync(target);
  } catch {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  if (!info.isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const extension = extname(target).toLowerCase();
  const isEntry = extension === ".js" || extension === ".css" || extension === ".html";
  res.writeHead(200, {
    "content-type": ASSET_CONTENT_TYPES[extension] ?? "application/octet-stream",
    "content-length": String(info.size),
    "cache-control": isEntry ? "no-cache" : "public, max-age=3600"
  });
  createReadStream(target).pipe(res);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function argString(args, key) {
  const value = args[key];
  return typeof value === "string" ? value : void 0;
}
function argNumber(args, key) {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function argRecord(args, key) {
  const value = args[key];
  return isRecord(value) ? value : void 0;
}
function setOptional(command, key, value) {
  if (value !== void 0) command[key] = value;
}
function canvasNotConnected(detail) {
  return {
    ok: false,
    error: "canvas_not_connected",
    message: detail
  };
}
var CanvasHub = class {
  sessions = /* @__PURE__ */ new Map();
  calls = /* @__PURE__ */ new Map();
  recent = [];
  /**
   * Record one diagnostic event for the `/health` readback.
   * @param entry - small JSON row describing the event.
   */
  note(entry) {
    this.recent.push({ at: Date.now(), ...entry });
    if (this.recent.length > 20) this.recent.splice(0, this.recent.length - 20);
  }
  /**
   * Resolve the canvas a tool call should act on.
   * @param sessionId - the calling agent's session id, when known.
   * @returns the live canvas, or undefined when none is usable.
   */
  resolve(sessionId) {
    this.prune();
    const live = [...this.sessions.values()].filter((canvas) => this.connected(canvas));
    if (sessionId !== void 0) {
      const exact = live.find((canvas) => canvas.sessionId === sessionId);
      if (exact !== void 0) return exact;
    }
    const unbound = live.find((canvas) => canvas.sessionId === UNBOUND_SESSION);
    if (unbound !== void 0 && unbound.workspace !== null) return unbound;
    if (live.length === 1) return live[0];
    return void 0;
  }
  /**
   * Store one browser snapshot.
   * @param sessionId - session the snapshot belongs to.
   * @param revision - client snapshot revision.
   * @param workspace - serialized circuit workspace.
   */
  ingest(sessionId, revision, workspace) {
    const canvas = this.ensure(sessionId);
    canvas.revision = revision;
    canvas.workspace = workspace;
    canvas.lastSeenAt = Date.now();
    this.prune();
  }
  /**
   * Queue one command for the browser dock and await its acknowledgement.
   * @param sessionId - the calling agent's session id, when known.
   * @param command - canvas command from the bridge protocol.
   * @param signal - caller cancellation.
   * @returns the browser acknowledgement, or a structured failure.
   */
  async enqueue(sessionId, command, signal) {
    const canvas = this.resolve(sessionId);
    this.note({ kind: "enqueue", requested: sessionId ?? null, resolved: canvas === void 0 ? null : canvas.sessionId });
    if (canvas === void 0) {
      return {
        ok: false,
        error: "canvas_not_connected",
        message: "No VelAgent circuit canvas is connected. Ask the user to open the VelAgent circuit panel in this app, then retry."
      };
    }
    canvas.opSeq += 1;
    const opId = canvas.sessionId + ":" + String(canvas.opSeq);
    canvas.pending.push({ id: opId, command });
    this.wake(canvas);
    return await new Promise((resolve2) => {
      const call = { sessionId: canvas.sessionId, opId, resolve: resolve2, timer: void 0 };
      this.calls.set(opId, call);
      const settle = (ack) => {
        if (!this.calls.delete(opId)) return;
        if (call.timer !== void 0) clearTimeout(call.timer);
        signal.removeEventListener("abort", onAbort);
        resolve2(ack);
      };
      const onAbort = () => {
        const index = canvas.pending.findIndex((op) => op.id === opId);
        if (index >= 0) canvas.pending.splice(index, 1);
        settle({ ok: false, error: "canvas_cancelled", message: "The canvas operation was cancelled." });
      };
      call.timer = setTimeout(() => {
        const index = canvas.pending.findIndex((op) => op.id === opId);
        if (index >= 0) canvas.pending.splice(index, 1);
        settle({ ok: false, error: "canvas_timeout", message: "The canvas dock did not acknowledge the operation in time." });
      }, OP_TIMEOUT_MS);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  /**
   * Long-poll one session's queued operations.
   * @param sessionId - polling session.
   * @param waitMs - requested hold time before an empty answer.
   * @param signal - caller cancellation.
   * @returns the current queue and its cursor.
   */
  async poll(sessionId, waitMs, signal) {
    const canvas = this.ensure(sessionId);
    canvas.lastSeenAt = Date.now();
    if (canvas.pending.length > 0) return { cursor: canvas.opSeq, ops: canvas.pending.splice(0) };
    await this.hold(canvas, waitMs, signal);
    canvas.lastSeenAt = Date.now();
    return { cursor: canvas.opSeq, ops: canvas.pending.splice(0) };
  }
  /**
   * Accept one browser acknowledgement.
   * @param opId - operation id the dock echoes.
   * @param ack - acknowledgement value from the browser.
   * @param workspace - the post-operation snapshot, when the dock sent one.
   * @returns whether a matching in-flight operation existed.
   */
  acknowledge(opId, ack, workspace) {
    const call = this.calls.get(opId);
    if (call === void 0) return false;
    if (call.timer !== void 0) clearTimeout(call.timer);
    this.calls.delete(opId);
    this.note({ kind: "ack", opId, ok: ack.ok });
    const canvas = this.sessions.get(call.sessionId);
    if (canvas !== void 0) {
      canvas.lastSeenAt = Date.now();
      if (workspace !== void 0) canvas.workspace = workspace;
    }
    call.resolve(ack);
    return true;
  }
  /**
   * Read one session's stored snapshot without waiting.
   * @param sessionId - session id from the request.
   * @returns connection state, revision, and the stored workspace.
   */
  snapshot(sessionId) {
    this.prune();
    const canvas = this.resolve(sessionId);
    if (canvas === void 0) return { connected: false, revision: 0, workspace: null };
    return { connected: true, revision: canvas.revision, workspace: canvas.workspace };
  }
  /**
   * Report every canvas known to this process, for diagnostics.
   * @returns one row per stored session.
   */
  health() {
    this.prune();
    const now = Date.now();
    return {
      ok: true,
      recent: this.recent,
      sessions: [...this.sessions.values()].map((canvas) => ({
        sessionId: canvas.sessionId,
        revision: canvas.revision,
        ageMs: now - canvas.lastSeenAt,
        connected: this.connected(canvas),
        pending: canvas.pending.length
      }))
    };
  }
  /** Settle every in-flight call and drop all canvas state. */
  dispose() {
    for (const call of this.calls.values()) {
      if (call.timer !== void 0) clearTimeout(call.timer);
      call.resolve({ ok: false, error: "canvas_shutdown", message: "The canvas host plugin is shutting down." });
    }
    this.calls.clear();
    this.sessions.clear();
  }
  ensure(sessionId) {
    const existing = this.sessions.get(sessionId);
    if (existing !== void 0) return existing;
    const canvas = {
      sessionId,
      revision: 0,
      workspace: null,
      lastSeenAt: Date.now(),
      opSeq: 0,
      pending: [],
      waiters: /* @__PURE__ */ new Set()
    };
    this.sessions.set(sessionId, canvas);
    return canvas;
  }
  connected(canvas) {
    return Date.now() - canvas.lastSeenAt <= CONNECTED_AGE_MS;
  }
  wake(canvas) {
    for (const waiter of [...canvas.waiters]) waiter();
  }
  hold(canvas, waitMs, signal) {
    return new Promise((resolve2) => {
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== void 0) clearTimeout(timer);
        canvas.waiters.delete(finish);
        signal.removeEventListener("abort", finish);
        resolve2();
      };
      timer = setTimeout(finish, Math.min(Math.max(waitMs, 1), MAX_POLL_MS));
      canvas.waiters.add(finish);
      if (signal.aborted) finish();
      else signal.addEventListener("abort", finish, { once: true });
    });
  }
  prune() {
    const now = Date.now();
    const busy = /* @__PURE__ */ new Set();
    for (const call of this.calls.values()) busy.add(call.sessionId);
    for (const [sessionId, canvas] of [...this.sessions]) {
      if (busy.has(sessionId)) continue;
      if (now - canvas.lastSeenAt > SESSION_IDLE_MS) this.sessions.delete(sessionId);
    }
  }
};
async function readJsonBody(req) {
  const parts = [];
  let size = 0;
  let overflow = false;
  return await new Promise((resolve2) => {
    req.on("data", (chunk) => {
      if (overflow) return;
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => {
      if (overflow) {
        resolve2({ ok: false, status: 413, message: "request body exceeds " + String(MAX_BODY_BYTES) + " bytes" });
        return;
      }
      const merged = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.byteLength;
      }
      const text = new TextDecoder().decode(merged);
      if (text.trim().length === 0) {
        resolve2({ ok: true, value: null });
        return;
      }
      try {
        resolve2({ ok: true, value: JSON.parse(text) });
      } catch {
        resolve2({ ok: false, status: 400, message: "request body must be JSON" });
      }
    });
    req.on("error", () => resolve2({ ok: false, status: 400, message: "request stream failed" }));
  });
}
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(body);
}
function sendEmpty(res, status) {
  res.statusCode = status;
  res.end();
}
function queryParam(req, key) {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get(key) ?? void 0;
}
async function workspaceRootOf(ctx, sessionId) {
  if (sessionId === void 0) return void 0;
  const live = ctx.sessions.get(sessionId)?.header.cwd;
  if (live !== void 0) return live;
  const stored = await ctx.get("sessionPersistence")?.stat(sessionId);
  return stored?.header.cwd;
}
async function workspaceTarget(ctx, sessionId, relativePath) {
  const root = await workspaceRootOf(ctx, sessionId);
  if (root === void 0) return { status: 404, error: "session workspace is unavailable" };
  const rootTarget = await ctx.fs.resolve(root);
  const cleaned = relativePath.replace(/^[\\/]+/, "");
  const target = await ctx.fs.resolve(cleaned.length === 0 ? root : join(root, cleaned));
  if (!ctx.fs.contains(rootTarget, target)) return { status: 400, error: "path escapes the workspace root" };
  return { root, target };
}
function workspacePolicy(ctx, sessionId) {
  const policy = ctx.get("sandboxPolicy");
  if (policy === void 0) return void 0;
  const live = sessionId === void 0 ? void 0 : ctx.sessions.get(sessionId);
  return policy.resolve(live === void 0 ? { mode: "danger-full-access" } : { session: live });
}
function registerRoutes(ctx, hub) {
  const routes = [
    {
      kind: "exact",
      path: ROUTE_ROOT + "/snapshot",
      async handler(req, res) {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message });
          return;
        }
        if (!isRecord(body.value)) {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        const sessionId = argString(body.value, "sessionId") ?? UNBOUND_SESSION;
        const revision = argNumber(body.value, "revision") ?? 0;
        hub.ingest(sessionId, revision, body.value.workspace ?? null);
        sendEmpty(res, 204);
      }
    },
    {
      kind: "exact",
      path: ROUTE_ROOT + "/ack",
      async handler(req, res) {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message });
          return;
        }
        if (!isRecord(body.value)) {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        const opId = argString(body.value, "opId");
        if (opId === void 0) {
          sendJson(res, 400, { error: "opId is required" });
          return;
        }
        const ack = {
          ok: body.value.ok !== false,
          ...body.value.result === void 0 ? {} : { result: body.value.result },
          ...typeof body.value.error === "string" ? { error: body.value.error } : {}
        };
        hub.acknowledge(opId, ack, body.value.workspace);
        sendEmpty(res, 204);
      }
    },
    {
      kind: "exact",
      path: ROUTE_ROOT + "/ops",
      async handler(req, res) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "use GET" });
          return;
        }
        const sessionId = queryParam(req, "sessionId") ?? UNBOUND_SESSION;
        const wait = Number(queryParam(req, "wait") ?? "");
        const waitMs = Number.isFinite(wait) && wait > 0 ? wait : DEFAULT_POLL_MS;
        const result = await hub.poll(sessionId, waitMs, new AbortController().signal);
        sendJson(res, 200, { cursor: result.cursor, ops: result.ops.map((op) => ({ id: op.id, command: op.command })) });
      }
    },
    {
      kind: "exact",
      path: ROUTE_ROOT + "/state",
      async handler(req, res) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "use GET" });
          return;
        }
        sendJson(res, 200, hub.snapshot(queryParam(req, "sessionId")));
      }
    },
    {
      kind: "exact",
      path: WORKSPACE_ROOT + "/list",
      async handler(req, res) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "use GET" });
          return;
        }
        const resolved = await workspaceTarget(ctx, queryParam(req, "sessionId"), queryParam(req, "path") ?? "");
        if ("error" in resolved) {
          sendJson(res, resolved.status, { error: resolved.error });
          return;
        }
        const info = await ctx.fs.stat(resolved.target);
        if (info === void 0 || info.type !== "directory") {
          sendJson(res, 404, { error: "not a workspace directory" });
          return;
        }
        const entries = (await ctx.fs.listDir(resolved.target)).slice(0, WORKSPACE_LIST_MAX_ENTRIES);
        sendJson(res, 200, {
          ok: true,
          root: resolved.root,
          name: basename(resolved.root),
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.type,
            ...entry.size === void 0 ? {} : { bytes: entry.size }
          }))
        });
      }
    },
    {
      kind: "exact",
      path: WORKSPACE_ROOT + "/read",
      async handler(req, res) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "use GET" });
          return;
        }
        const relativePath = queryParam(req, "path");
        if (relativePath === void 0 || relativePath.length === 0) {
          sendJson(res, 400, { error: "path is required" });
          return;
        }
        const resolved = await workspaceTarget(ctx, queryParam(req, "sessionId"), relativePath);
        if ("error" in resolved) {
          sendJson(res, resolved.status, { error: resolved.error });
          return;
        }
        const info = await ctx.fs.stat(resolved.target);
        if (info === void 0 || info.type !== "file") {
          sendJson(res, 404, { error: "not a workspace file" });
          return;
        }
        if (info.size !== void 0 && info.size > WORKSPACE_READ_MAX_BYTES) {
          sendJson(res, 413, { error: "file exceeds the workbench read cap" });
          return;
        }
        const text = await ctx.fs.readText(resolved.target);
        sendJson(res, 200, {
          ok: true,
          path: relativePath,
          text,
          version: info.version,
          ...info.size === void 0 ? {} : { bytes: info.size }
        });
      }
    },
    {
      kind: "exact",
      path: WORKSPACE_ROOT + "/write",
      async handler(req, res) {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message });
          return;
        }
        if (!isRecord(body.value)) {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        const relativePath = argString(body.value, "path");
        const content = argString(body.value, "content");
        if (relativePath === void 0 || relativePath.length === 0) {
          sendJson(res, 400, { error: "path is required" });
          return;
        }
        if (content === void 0) {
          sendJson(res, 400, { error: "content is required" });
          return;
        }
        if (content.length > WORKSPACE_WRITE_MAX_BYTES) {
          sendJson(res, 413, { error: "content exceeds the workbench write cap" });
          return;
        }
        const resolved = await workspaceTarget(ctx, argString(body.value, "sessionId"), relativePath);
        if ("error" in resolved) {
          sendJson(res, resolved.status, { error: resolved.error });
          return;
        }
        try {
          const live = ctx.sessions.get(argString(body.value, "sessionId") ?? "");
          const policy = ctx.get("sandboxPolicy");
          const resolvedPolicy = policy === void 0 ? void 0 : policy.resolve(live === void 0 ? { mode: "danger-full-access" } : { session: live });
          const outcome = await ctx.fs.writeText(resolved.target, content, void 0, void 0, resolvedPolicy);
          sendJson(res, 200, { ok: true, version: outcome.version, operation: outcome.operation });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    {
      kind: "exact",
      path: WORKSPACE_ROOT + "/mkdir",
      async handler(req, res) {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message });
          return;
        }
        if (!isRecord(body.value)) {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        const relativePath = argString(body.value, "path");
        if (relativePath === void 0 || relativePath.length === 0) {
          sendJson(res, 400, { error: "path is required" });
          return;
        }
        const resolved = await workspaceTarget(ctx, argString(body.value, "sessionId"), relativePath);
        if ("error" in resolved) {
          sendJson(res, resolved.status, { error: resolved.error });
          return;
        }
        try {
          await mkdir(ctx.fs.processPath(resolved.target), { recursive: false });
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    {
      kind: "exact",
      path: WORKSPACE_ROOT + "/rename",
      async handler(req, res) {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message });
          return;
        }
        if (!isRecord(body.value)) {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        const from = argString(body.value, "from");
        const to = argString(body.value, "to");
        if (from === void 0 || from.length === 0 || to === void 0 || to.length === 0) {
          sendJson(res, 400, { error: "from and to are required" });
          return;
        }
        const sessionId = argString(body.value, "sessionId");
        const source = await workspaceTarget(ctx, sessionId, from);
        if ("error" in source) {
          sendJson(res, source.status, { error: source.error });
          return;
        }
        const destination = await workspaceTarget(ctx, sessionId, to);
        if ("error" in destination) {
          sendJson(res, destination.status, { error: destination.error });
          return;
        }
        const sourceInfo = await ctx.fs.stat(source.target);
        if (sourceInfo === void 0) {
          sendJson(res, 404, { error: "no such workspace path" });
          return;
        }
        try {
          if (sourceInfo.type === "directory") {
            await renamePath(ctx.fs.processPath(source.target), ctx.fs.processPath(destination.target));
          } else {
            await ctx.fs.moveFile(source.target, destination.target, {}, void 0, workspacePolicy(ctx, sessionId));
          }
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
    {
      kind: "exact",
      path: WORKSPACE_ROOT + "/delete",
      async handler(req, res) {
        const body = await readJsonBody(req);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.message });
          return;
        }
        if (!isRecord(body.value)) {
          sendJson(res, 400, { error: "body must be a JSON object" });
          return;
        }
        const relativePath = argString(body.value, "path");
        if (relativePath === void 0 || relativePath.length === 0) {
          sendJson(res, 400, { error: "path is required" });
          return;
        }
        const sessionId = argString(body.value, "sessionId");
        const resolved = await workspaceTarget(ctx, sessionId, relativePath);
        if ("error" in resolved) {
          sendJson(res, resolved.status, { error: resolved.error });
          return;
        }
        const info = await ctx.fs.stat(resolved.target);
        if (info === void 0) {
          sendJson(res, 404, { error: "no such workspace path" });
          return;
        }
        try {
          const policy = workspacePolicy(ctx, sessionId);
          if (info.type === "file") await ctx.fs.deleteFile(resolved.target, void 0, void 0, policy);
          else if (info.type === "directory") await rmdir(ctx.fs.processPath(resolved.target));
          else {
            sendJson(res, 400, { error: "only files and directories can be removed" });
            return;
          }
          sendJson(res, 200, { ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const notEmpty = message.includes("ENOTEMPTY") || message.includes("not empty");
          sendJson(res, notEmpty ? 409 : 500, {
            error: notEmpty ? "directory is not empty; remove its files first" : message
          });
        }
      }
    },
    {
      kind: "exact",
      path: ROUTE_ROOT + "/health",
      async handler(req, res) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "use GET" });
          return;
        }
        sendJson(res, 200, hub.health());
      }
    },
    {
      kind: "exact",
      path: "/components-metadata.json",
      handler(_req, res) {
        serveUiAsset("/components-metadata.json", res);
      }
    },
    ...UI_PUBLIC_ROOTS.map((root) => ({
      kind: "prefix",
      path: root,
      handler(req, res) {
        serveUiAsset(root + requestPathname(req).slice(root.length), res);
      }
    })),
    {
      kind: "prefix",
      path: ASSET_ROOT,
      handler(req, res) {
        serveUiAsset(requestPathname(req).slice(ASSET_ROOT.length), res);
      }
    }
  ];
  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route), "ui-velagent route " + route.path);
  }
}
function hostTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args, exec) {
      return spec.run(isRecord(args) ? args : {}, exec);
    }
  };
}
async function runCommand(hub, sessionId, command, signal) {
  const ack = await hub.enqueue(sessionId, command, signal);
  if (!ack.ok) {
    return {
      ok: false,
      error: ack.error ?? "canvas_error",
      message: ack.message ?? "The canvas rejected the operation."
    };
  }
  if (isRecord(ack.result)) return { ok: true, ...ack.result };
  return { ok: true, result: ack.result ?? null };
}
function boardRow(row) {
  if (!isRecord(row)) return row;
  return {
    id: row.id ?? null,
    ref: row.ref ?? null,
    kind: row.kind ?? null,
    name: row.name ?? null,
    x: row.x ?? null,
    y: row.y ?? null,
    rotation: row.rotation ?? null
  };
}
function componentRow(row) {
  if (!isRecord(row)) return row;
  return {
    id: row.id ?? null,
    ref: row.ref ?? null,
    metadata_id: row.metadata_id ?? null,
    x: row.x ?? null,
    y: row.y ?? null,
    rotation: row.rotation ?? null
  };
}
function wireRow(row) {
  if (!isRecord(row)) return row;
  return {
    id: row.id ?? null,
    from: row.from ?? null,
    to: row.to ?? null,
    color: row.color ?? null,
    signal: row.signal ?? null
  };
}
function workspaceArray(workspace, key) {
  if (!isRecord(workspace)) return [];
  const value = workspace[key];
  return Array.isArray(value) ? value : [];
}
function registerTools(ctx, hub) {
  const sessionOf = (exec) => {
    if (exec.agent === void 0) return void 0;
    return exec.agent.session.id;
  };
  const tools = [
    hostTool({
      name: "velagent_read_circuit",
      description: "Read the live VelAgent circuit canvas for this session: boards, components, wires, and counts. Call this before editing; call again after edits to verify. Returns canvas_not_connected when the user has not opened the canvas panel.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          full: { type: "boolean", description: "Also return full component properties and raw wire rows." }
        }
      },
      async run(args, exec) {
        const canvas = hub.resolve(sessionOf(exec));
        if (canvas === void 0 || canvas.workspace === null) {
          return canvasNotConnected("No VelAgent circuit canvas is connected. Ask the user to open the VelAgent circuit panel in this app, then retry.");
        }
        const workspace = canvas.workspace;
        const boards = workspaceArray(workspace, "boards");
        const components = workspaceArray(workspace, "components");
        const wires = workspaceArray(workspace, "wires");
        const full = args.full === true;
        return {
          ok: true,
          revision: canvas.revision,
          summary: {
            boards: boards.length,
            components: components.length,
            wires: wires.length
          },
          boards: full ? boards : boards.map(boardRow),
          components: full ? components : components.map(componentRow),
          wires: full ? wires : wires.map(wireRow)
        };
      }
    }),
    hostTool({
      name: "velagent_place_board",
      description: 'Place a development board on the VelAgent canvas and return its id. Board kinds come from the VelAgent board catalog (for example a board kind such as "arduino-uno").',
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: { type: "string", description: 'Board kind, e.g. "arduino-uno". Call velagent_list_components for the full list.' },
          x: { type: "number", description: "Canvas x position in pixels." },
          y: { type: "number", description: "Canvas y position in pixels." },
          name: { type: "string", description: "Optional display name for the board." },
          ref: { type: "string", description: 'Optional variable name such as "U1". Auto-assigned when omitted; results include the ref and real pin names.' }
        }
      },
      async run(args, exec) {
        const kind = argString(args, "kind");
        if (kind === void 0 || kind.length === 0) return { ok: false, error: "invalid_args", message: "kind is required" };
        const command = { op: "place_board", kind };
        setOptional(command, "x", argNumber(args, "x"));
        setOptional(command, "y", argNumber(args, "y"));
        setOptional(command, "name", argString(args, "name"));
        setOptional(command, "ref", argString(args, "ref"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_place_component",
      description: 'Place a component on the VelAgent canvas and return its id. metadata_id comes from the VelAgent component catalog (for example "led", "resistor", "pushbutton", or "breadboard").',
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["metadata_id"],
        properties: {
          metadata_id: { type: "string", description: 'Component metadata id, e.g. "led". Call velagent_list_components for the full list.' },
          x: { type: "number", description: "Canvas x position in pixels." },
          y: { type: "number", description: "Canvas y position in pixels." },
          rotation: { type: "number", description: "Rotation in degrees." },
          seat_on: { type: "string", description: 'Breadboard hole to seat the component on, e.g. "a3".' },
          properties: { type: "object", description: "Component property overrides." },
          ref: { type: "string", description: 'Optional variable name such as "R1". Auto-assigned when omitted; results include the ref and real pin names.' }
        }
      },
      async run(args, exec) {
        const metadataId = argString(args, "metadata_id");
        if (metadataId === void 0 || metadataId.length === 0) {
          return { ok: false, error: "invalid_args", message: "metadata_id is required" };
        }
        const command = { op: "place_component", metadata_id: metadataId };
        setOptional(command, "x", argNumber(args, "x"));
        setOptional(command, "y", argNumber(args, "y"));
        setOptional(command, "rotation", argNumber(args, "rotation"));
        setOptional(command, "seat_on", argString(args, "seat_on"));
        setOptional(command, "properties", argRecord(args, "properties"));
        setOptional(command, "ref", argString(args, "ref"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_update_component",
      description: "Move, rotate, or re-property one canvas component by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", description: "Component id returned by velagent_place_component." },
          patch: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "number", description: "New x position." },
              y: { type: "number", description: "New y position." },
              rotation: { type: "number", description: "New rotation in degrees." },
              properties: { type: "object", description: "Property overrides." }
            }
          }
        }
      },
      async run(args, exec) {
        const id = argString(args, "id");
        if (id === void 0) return { ok: false, error: "invalid_args", message: "id is required" };
        return await runCommand(hub, sessionOf(exec), {
          op: "update_component",
          id,
          patch: argRecord(args, "patch") ?? {}
        }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_remove_component",
      description: "Remove one component (or board-side part) from the canvas by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string", description: "Component id to remove." } }
      },
      async run(args, exec) {
        const id = argString(args, "id");
        if (id === void 0) return { ok: false, error: "invalid_args", message: "id is required" };
        return await runCommand(hub, sessionOf(exec), { op: "remove_component", id }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_connect",
      description: "Wire two pins together on the canvas. Build the circuit first (place a board and components); results include each part ref and its real pin names. Endpoints accept either ref or owner_id. Unknown pins are rejected with the list of pins that exist.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: {
            type: "object",
            additionalProperties: false,
            required: ["pin"],
            properties: {
              owner_id: { type: "string", description: "Board or component id of the start endpoint (or use ref)." },
              ref: { type: "string", description: 'Variable name of the start endpoint, e.g. "U1" (alternative to owner_id).' },
              pin: { type: "string", description: 'Pin name on the start owner, e.g. "13" or "GND.1". Breadboard holes use row+column, e.g. "a5".' }
            }
          },
          to: {
            type: "object",
            additionalProperties: false,
            required: ["pin"],
            properties: {
              owner_id: { type: "string", description: "Board or component id of the end endpoint (or use ref)." },
              ref: { type: "string", description: 'Variable name of the end endpoint, e.g. "R1" (alternative to owner_id).' },
              pin: { type: "string", description: 'Pin name on the end owner, e.g. "A" or "C". Breadboard holes use row+column, e.g. "a5".' }
            }
          },
          color: { type: "string", description: "Optional wire color." },
          signal: { type: "string", description: 'Optional signal type, e.g. "digital".' }
        }
      },
      async run(args, exec) {
        const from = argRecord(args, "from");
        const to = argRecord(args, "to");
        if (from === void 0 || to === void 0) {
          return { ok: false, error: "invalid_args", message: "from and to are required objects" };
        }
        const command = { op: "connect", from, to };
        setOptional(command, "color", argString(args, "color"));
        setOptional(command, "signal", argString(args, "signal"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_remove_wire",
      description: "Remove one wire from the canvas by wire id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string", description: "Wire id to remove." } }
      },
      async run(args, exec) {
        const id = argString(args, "id");
        if (id === void 0) return { ok: false, error: "invalid_args", message: "id is required" };
        return await runCommand(hub, sessionOf(exec), { op: "remove_wire", id }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_validate",
      description: "Run the VelAgent circuit validator over the current canvas (unconnected pins, missing ground, conflicting pins) and return the issues.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async run(_args, exec) {
        return await runCommand(hub, sessionOf(exec), { op: "validate" }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_highlight",
      description: "Highlight a component or pins on the canvas so the user sees what the answer refers to. Accepts an optional explanatory message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          owner_id: { type: "string", description: "Component or board id to highlight." },
          pins: { type: "array", items: { type: "string" }, description: "Pin names to highlight on that owner." },
          message: { type: "string", description: "Short explanation shown by the highlight." }
        }
      },
      async run(args, exec) {
        const command = { op: "highlight" };
        setOptional(command, "owner_id", argString(args, "owner_id"));
        setOptional(command, "pins", args.pins);
        setOptional(command, "message", argString(args, "message"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_read_code",
      description: "Read the code editor files of the docked VelAgent workspace: the active file name and every file with content. Use it together with velagent_read_circuit before analyzing or changing firmware.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async run(_args, exec) {
        return await runCommand(hub, sessionOf(exec), { op: "code_get" }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_write_code",
      description: "Write code into the docked VelAgent editor. Omit name to replace the active file; pass name to write that file (creating it when missing). Use it to fix or generate firmware the user can read in the code tab.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: {
          content: { type: "string", description: "Complete file content to write." },
          name: { type: "string", description: "File name to write; omit for the active file." }
        }
      },
      async run(args, exec) {
        const content = argString(args, "content");
        if (content === void 0) return { ok: false, error: "invalid_args", message: "content is required" };
        const command = { op: "code_set", content };
        setOptional(command, "name", argString(args, "name"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_play_timeline",
      description: "Animate a predicted run on the canvas: play a timeline of LED states and serial output so the user sees what the firmware would do. Read the circuit and code first, then derive the timeline from digitalWrite/delay/Serial calls.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["timeline"],
        properties: {
          timeline: {
            type: "array",
            description: "Ordered steps; t is milliseconds from the start.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["t"],
              properties: {
                t: { type: "number", description: "Start time in milliseconds." },
                leds: { type: "object", description: "Component id to lit state." },
                serial: { type: "string", description: "Serial line printed at this step." },
                note: { type: "string", description: "Short explanation shown with the step." }
              }
            }
          },
          explain: { type: "string", description: "One-paragraph explanation of the predicted behavior." },
          warnings: { type: "array", items: { type: "string" }, description: "Problems noticed while deriving the timeline." }
        }
      },
      async run(args, exec) {
        const timeline = args.timeline;
        if (!Array.isArray(timeline)) return { ok: false, error: "invalid_args", message: "timeline is required" };
        const command = { op: "timeline_play", timeline };
        setOptional(command, "explain", argString(args, "explain"));
        setOptional(command, "warnings", args.warnings);
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_stop_timeline",
      description: "Stop the timeline animation currently playing on the canvas.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async run(_args, exec) {
        return await runCommand(hub, sessionOf(exec), { op: "timeline_stop" }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_clear",
      description: "Remove every board, component, and wire from the canvas. Use only when the user asks to start over.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async run(_args, exec) {
        return await runCommand(hub, sessionOf(exec), { op: "clear" }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_list_components",
      description: "List the boards and component types this canvas supports, with their parameter names. Call it when you are unsure which kind or metadata_id to place.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async run(_args, exec) {
        return await runCommand(hub, sessionOf(exec), { op: "catalog" }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_read_pins",
      description: "Return the real pin names of one board or component (by ref or id). Use it before wiring when you are not sure of a pin name; breadboards answer with their hole naming rule.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ref: { type: "string", description: 'Variable name of the part, e.g. "U1".' },
          owner_id: { type: "string", description: "Canvas id of the part (alternative to ref)." }
        }
      },
      async run(args, exec) {
        const command = { op: "pins" };
        setOptional(command, "ref", argString(args, "ref"));
        setOptional(command, "owner_id", argString(args, "owner_id"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_read_circuit_json",
      description: 'Read the circuit as the human-readable JSON document (parts with refs, wires written as "ref.pin", derived nets). This is the same document the JSON tab shows; edit it and call velagent_apply_circuit_json to apply.',
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async run(_args, exec) {
        return await runCommand(hub, sessionOf(exec), { op: "json_get" }, exec.signal);
      }
    }),
    hostTool({
      name: "velagent_apply_circuit_json",
      description: "Replace the canvas with a circuit JSON document. Validate first: unknown refs, unknown pins, duplicate wires and bad types are rejected and the canvas stays unchanged; a successful apply is atomic.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          json: { type: "object", additionalProperties: true, description: "Circuit JSON object (\u7248\u672C/\u540D\u79F0/\u5143\u4EF6/\u8FDE\u7EBF\u2026)." },
          text: { type: "string", description: "Circuit JSON text (alternative to json)." }
        }
      },
      async run(args, exec) {
        const command = { op: "json_apply" };
        setOptional(command, "json", argRecord(args, "json"));
        setOptional(command, "text", argString(args, "text"));
        return await runCommand(hub, sessionOf(exec), command, exec.signal);
      }
    })
  ];
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool), "ui-velagent tool " + tool.name);
  }
}
var CANVAS_PROMPT = [
  "A live VelAgent workspace can be docked in this application beside the conversation: a circuit canvas and a code editor.",
  "Every board and component has a stable variable name (ref) such as U1 / R1 / D1 / B1; tools accept either ref or canvas id, and place results include the ref and the real pin names.",
  "When the user asks about the circuit or code, use the velagent_* tools: read first (velagent_read_circuit, velagent_read_code), place boards and components before wiring them, run velagent_validate after wiring, and edit firmware with velagent_write_code.",
  "Wire only pins that exist: velagent_connect rejects unknown pins and returns the available list; velagent_read_pins answers pin names for one part; velagent_list_components answers kinds and parameter names.",
  "The circuit can also be edited as a JSON document with velagent_read_circuit_json and replaced atomically with velagent_apply_circuit_json; the user sees the same JSON in the workspace JSON tab.",
  "To demonstrate behavior, derive a timeline from digitalWrite/delay/Serial calls and play it with velagent_play_timeline; stop it with velagent_stop_timeline.",
  "Tool results reporting canvas_not_connected mean the user has not opened the canvas panel; ask them to open it instead of guessing its contents."
].join(" ");
function apply(ctx) {
  const hub = new CanvasHub();
  ctx.effect(() => () => {
    hub.dispose();
  }, "ui-velagent canvas hub");
  registerRoutes(ctx, hub);
  registerTools(ctx, hub);
  ctx.effect(() => ctx.systemPrompt.section({
    name: "velagent:circuit-canvas",
    order: 82,
    text: CANVAS_PROMPT
  }), "ui-velagent prompt section");
}
export {
  apply,
  inject,
  name
};
