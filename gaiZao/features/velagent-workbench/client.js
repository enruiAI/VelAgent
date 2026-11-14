// velagent-workbench browser half: official dynamic client module-loader factory.
window.__ModuleLoader__.load({
  id: "velagent-workbench",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    (function (module, exports, require) {
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/VelAgentOverlay.tsx
var import_react = require("react");
var import_react_dom = require("react-dom");

// src/client/canvasSync.ts
var NO_CAPABILITIES = {
  workspace: false,
  editor: false,
  timeline: false,
  export: false
};
var CANVAS_STYLESHEET_PATH = "/velagent-assets/velxio-ui.css";
var EMBED_SCRIPT_PATH = "/velagent-assets/velagent-embed.js";
var SNAPSHOT_PATH = "/velagent/canvas/snapshot";
var OPS_PATH = "/velagent/canvas/ops";
var ACK_PATH = "/velagent/canvas/ack";
var SNAPSHOT_DEBOUNCE_MS = 120;
var OPS_WAIT_MS = 2e4;
var RETRY_DELAY_MS = 1e3;
var EMBED_LOAD_TIMEOUT_MS = 1e4;
var LOAD_ATTEMPTS = 3;
var SUPPORTED_EMBED_VERSION = 3;
var FALLBACK_EMBED_VERSION = 2;
var LEGACY_EMBED_VERSION = 1;
var embedLoader;
function loadEmbed() {
  const pending = embedLoader;
  if (pending !== void 0) return pending;
  const loading = loadEmbedOnce().catch((error) => {
    embedLoader = void 0;
    throw error;
  });
  embedLoader = loading;
  return loading;
}
async function loadEmbedOnce() {
  ensureCanvasStylesheet();
  const installed = window.VelAgentEmbed;
  const api = installed ?? await waitForEmbedScript();
  const version = api.version;
  if (version !== void 0 && (version < LEGACY_EMBED_VERSION || version > SUPPORTED_EMBED_VERSION)) {
    throw new Error(`unsupported VelAgentEmbed version ${String(version)} (supported ${LEGACY_EMBED_VERSION}\u2013${SUPPORTED_EMBED_VERSION})`);
  }
  return api;
}
function capabilitiesOf(api) {
  const generation = api.version ?? 0;
  return {
    workspace: generation >= SUPPORTED_EMBED_VERSION && typeof api.mountWorkspace === "function",
    editor: generation >= FALLBACK_EMBED_VERSION && typeof api.mountEditor === "function",
    timeline: generation >= FALLBACK_EMBED_VERSION && typeof api.playTimeline === "function",
    export: generation >= FALLBACK_EMBED_VERSION && typeof api.exportProject === "function"
  };
}
function ensureCanvasStylesheet() {
  if (document.querySelector("link[data-velagent-css]") !== null) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CANVAS_STYLESHEET_PATH;
  link.dataset.velagentCss = "1";
  document.head.append(link);
}
function waitForEmbedScript() {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-velagent-embed]");
    const script = existing ?? document.createElement("script");
    let timer;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== void 0) clearTimeout(timer);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (error !== void 0) {
        reject(error);
        return;
      }
      const api = window.VelAgentEmbed;
      if (api === void 0) {
        reject(new Error(`embed script did not install window.VelAgentEmbed (${EMBED_SCRIPT_PATH})`));
        return;
      }
      resolve(api);
    };
    const onLoad = () => {
      finish();
    };
    const onError = () => {
      finish(new Error(`embed script failed to load (${EMBED_SCRIPT_PATH})`));
    };
    timer = setTimeout(() => {
      finish(new Error(`embed script timed out (${EMBED_SCRIPT_PATH})`));
    }, EMBED_LOAD_TIMEOUT_MS);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (existing === null) {
      script.src = EMBED_SCRIPT_PATH;
      script.dataset.velagentEmbed = "1";
      document.body.append(script);
    }
  });
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
async function postJson(path, body, signal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`);
}
function parseOpsResponse(body) {
  if (typeof body !== "object" || body === null) throw new Error("canvas ops response is not an object");
  const record = body;
  if (typeof record.cursor !== "number" || !Number.isFinite(record.cursor)) {
    throw new Error("canvas ops response carries no numeric cursor");
  }
  if (!Array.isArray(record.ops)) throw new Error("canvas ops response carries no ops array");
  const ops = record.ops.map(parseOp);
  return { cursor: record.cursor, ops };
}
function parseOp(value) {
  if (typeof value !== "object" || value === null) throw new Error("canvas op is not an object");
  const record = value;
  if (typeof record.id !== "string" || record.id === "") throw new Error("canvas op carries no id");
  const command = record.command;
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new Error(`canvas op ${record.id} carries no command object`);
  }
  return { id: record.id, command };
}
var CanvasBridgeImpl = class {
  constructor(sessionId) {
    __publicField(this, "sessionId");
    __publicField(this, "listeners", /* @__PURE__ */ new Set());
    __publicField(this, "state", { status: "closed", capabilities: NO_CAPABILITIES });
    __publicField(this, "container");
    __publicField(this, "onAiRun");
    __publicField(this, "workspace");
    __publicField(this, "api");
    __publicField(this, "unmount");
    __publicField(this, "unsubscribe");
    __publicField(this, "controller");
    __publicField(this, "snapshotTimer");
    __publicField(this, "loadRetryTimer");
    __publicField(this, "pageCleanup");
    __publicField(this, "latest");
    __publicField(this, "sentRevision");
    __publicField(this, "cursor", 0);
    __publicField(this, "loadAttempts", 0);
    __publicField(this, "polling", false);
    __publicField(this, "disposed", false);
    this.sessionId = sessionId;
  }
  attach(container, options = {}) {
    if (this.disposed || this.container !== void 0) return;
    this.container = container;
    this.onAiRun = options.onAiRun;
    this.workspace = options.workspace;
    this.controller = new AbortController();
    this.setStatus("connecting");
    this.pageCleanup = () => {
      this.dispose();
    };
    window.addEventListener("pagehide", this.pageCleanup);
    void this.mount(container);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pageCleanup !== void 0) {
      window.removeEventListener("pagehide", this.pageCleanup);
      this.pageCleanup = void 0;
    }
    this.controller?.abort();
    this.controller = void 0;
    if (this.snapshotTimer !== void 0) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = void 0;
    }
    if (this.loadRetryTimer !== void 0) {
      clearTimeout(this.loadRetryTimer);
      this.loadRetryTimer = void 0;
    }
    this.unsubscribe?.();
    this.unsubscribe = void 0;
    const unmount = this.unmount;
    this.unmount = void 0;
    this.api = void 0;
    this.container = void 0;
    this.onAiRun = void 0;
    this.workspace = void 0;
    this.latest = void 0;
    this.setState({ status: "closed", capabilities: NO_CAPABILITIES });
    this.listeners.clear();
    if (unmount !== void 0) {
      try {
        unmount();
      } catch {
      }
    }
  }
  getState() {
    return this.state;
  }
  subscribeState(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Load, mount, and subscribe the embed content, then start the command loop.
   * @param container - dock element owning the embed content.
   */
  async mount(container) {
    try {
      const api = this.api ?? await loadEmbed();
      if (this.disposed) return;
      this.api = api;
      const capabilities = capabilitiesOf(api);
      this.setState({
        status: this.state.status,
        capabilities,
        ...api.version === void 0 ? {} : { embedVersion: api.version },
        ...this.state.error === void 0 ? {} : { error: this.state.error }
      });
      if (this.unmount === void 0) this.unmount = this.mountEmbed(api, container, capabilities.workspace);
      if (this.unsubscribe === void 0) {
        this.unsubscribe = api.subscribe((snapshot) => {
          this.onSnapshot(snapshot);
        });
      }
      this.onSnapshot(api.getState());
      if (!this.polling) {
        this.polling = true;
        void this.pollOps();
      }
    } catch (error) {
      if (this.disposed) return;
      this.setStatus("error", messageOf(error));
      this.scheduleLoadRetry();
    }
  }
  /**
   * Mount the full workbench when the embed provides it, otherwise the circuit canvas.
   * @param api - installed embed API.
   * @param container - dock element owning the embed content.
   * @param workspaceSupported - whether the loaded build advertises `mountWorkspace`.
   * @returns the unmount function.
   */
  mountEmbed(api, container, workspaceSupported) {
    const mountWorkspace = api.mountWorkspace;
    if (!workspaceSupported || mountWorkspace === void 0) return api.mount(container);
    const options = {
      ...this.onAiRun === void 0 ? {} : { onAiRun: this.onAiRun },
      ...this.workspace === void 0 ? {} : { workspace: this.workspace }
    };
    return mountWorkspace.call(api, container, options);
  }
  /** Retry a failed load/mount with the fixed retry delay, up to the attempt cap. */
  scheduleLoadRetry() {
    if (this.disposed || this.loadRetryTimer !== void 0 || this.loadAttempts >= LOAD_ATTEMPTS) return;
    this.loadAttempts += 1;
    this.loadRetryTimer = setTimeout(() => {
      this.loadRetryTimer = void 0;
      const container = this.container;
      if (this.disposed || container === void 0) return;
      void this.mount(container);
    }, RETRY_DELAY_MS);
  }
  /** Fold one workspace change into the pending snapshot push. */
  onSnapshot(snapshot) {
    if (this.disposed) return;
    this.latest = snapshot;
    this.scheduleSnapshot(SNAPSHOT_DEBOUNCE_MS);
  }
  /**
   * Schedule one snapshot push; an already pending push keeps the newer snapshot.
   * @param milliseconds - delay before the push.
   */
  scheduleSnapshot(milliseconds) {
    if (this.disposed || this.snapshotTimer !== void 0) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = void 0;
      void this.pushSnapshot();
    }, milliseconds);
  }
  /** Push the latest snapshot to the host, retrying on failure until a later edit supersedes it. */
  async pushSnapshot() {
    const workspace = this.latest;
    if (this.disposed || workspace === void 0) return;
    if (workspace.revision === this.sentRevision) return;
    const body = { ...this.sessionField(), revision: workspace.revision, workspace };
    try {
      await postJson(SNAPSHOT_PATH, body, this.signal());
      this.sentRevision = workspace.revision;
      this.setStatus("connected");
    } catch (error) {
      if (this.disposed) return;
      this.setStatus("error", messageOf(error));
      this.scheduleSnapshot(RETRY_DELAY_MS);
      return;
    }
    if (this.latest !== void 0 && this.latest.revision !== this.sentRevision) {
      this.scheduleSnapshot(SNAPSHOT_DEBOUNCE_MS);
    }
  }
  /** Long-poll the host's command queue; transport failures retry instead of ending the loop. */
  async pollOps() {
    while (!this.disposed) {
      try {
        const response = await this.requestOps();
        if (this.disposed) return;
        if (this.state.status !== "connected") {
          this.sentRevision = void 0;
          this.scheduleSnapshot(0);
        }
        this.setStatus("connected");
        this.cursor = response.cursor;
        for (const op of response.ops) {
          if (this.disposed) return;
          await this.runOp(op);
        }
      } catch (error) {
        if (this.disposed) return;
        this.cursor = 0;
        this.setStatus("error", messageOf(error));
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  /**
   * Request the next batch of commands.
   * @returns the host's cursor and delivered commands.
   */
  async requestOps() {
    const params = new URLSearchParams({ cursor: String(this.cursor), wait: String(OPS_WAIT_MS) });
    if (this.sessionId !== void 0) params.set("sessionId", this.sessionId);
    const response = await fetch(`${OPS_PATH}?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: this.signal()
    });
    if (!response.ok) throw new Error(`${OPS_PATH} failed with HTTP ${response.status}`);
    const body = await response.json();
    return parseOpsResponse(body);
  }
  /**
   * Execute one delivered command on the embed and acknowledge it.
   * @param op - command envelope delivered by the host.
   */
  async runOp(op) {
    const api = this.api;
    if (api === void 0) return;
    let ack;
    try {
      const outcome = await api.executeCommand(op.command);
      this.latest = outcome.workspace;
      this.scheduleSnapshot(SNAPSHOT_DEBOUNCE_MS);
      ack = { ...this.sessionField(), opId: op.id, ok: true, result: outcome.result, workspace: outcome.workspace };
    } catch (error) {
      ack = { ...this.sessionField(), opId: op.id, ok: false, error: messageOf(error) };
    }
    try {
      await postJson(ACK_PATH, ack, this.signal());
    } catch {
    }
  }
  /** Session field shared by push and ack bodies; omitted when the dock has no Session. */
  sessionField() {
    return this.sessionId === void 0 ? {} : { sessionId: this.sessionId };
  }
  /** Abort signal shared by every request of this attachment. */
  signal() {
    this.controller ?? (this.controller = new AbortController());
    return this.controller.signal;
  }
  /** Publish a new lifecycle status, retaining the loaded embed's generation and capabilities. */
  setStatus(status, error) {
    const current = this.state;
    this.setState({
      status,
      capabilities: current.capabilities,
      ...current.embedVersion === void 0 ? {} : { embedVersion: current.embedVersion },
      ...error === void 0 ? {} : { error }
    });
  }
  /** Publish a new bridge state when any published field differs from the current one. */
  setState(next) {
    const current = this.state;
    if (current.status === next.status && current.error === next.error && current.embedVersion === next.embedVersion && current.capabilities.workspace === next.capabilities.workspace && current.capabilities.editor === next.capabilities.editor && current.capabilities.timeline === next.capabilities.timeline && current.capabilities.export === next.capabilities.export) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
};
function createCanvasSync(options = {}) {
  return new CanvasBridgeImpl(options.sessionId);
}

// src/client/workspaceBridge.ts
var LIST_ROUTE = "/velagent/workspace/list";
var READ_ROUTE = "/velagent/workspace/read";
var WRITE_ROUTE = "/velagent/workspace/write";
var MKDIR_ROUTE = "/velagent/workspace/mkdir";
var RENAME_ROUTE = "/velagent/workspace/rename";
var DELETE_ROUTE = "/velagent/workspace/delete";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} is not a JSON object`);
  return value;
}
function requireString(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is not a string`);
  return value;
}
async function readJson(response, route) {
  const body = await response.json().catch(() => void 0);
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : "";
    throw new Error(`${route} failed with HTTP ${response.status}${detail}`);
  }
  return body;
}
function parseListing(body) {
  const record = requireRecord(body, "workspace list response");
  const entries = record.entries;
  if (!Array.isArray(entries)) throw new Error("workspace list response carries no entries array");
  return {
    root: requireString(record.root, "workspace list root"),
    name: requireString(record.name, "workspace list name"),
    entries: entries.map(parseEntry)
  };
}
function parseEntry(value) {
  const record = requireRecord(value, "workspace entry");
  const name = requireString(record.name, "workspace entry name");
  const type = record.type === "file" || record.type === "directory" ? record.type : void 0;
  if (type === void 0) throw new Error(`workspace entry "${name}" is neither a file nor a directory`);
  return typeof record.bytes === "number" && Number.isFinite(record.bytes) ? { name, type, bytes: record.bytes } : { name, type };
}
function parseFile(body) {
  const record = requireRecord(body, "workspace read response");
  return {
    text: requireString(record.text, "workspace read text"),
    version: requireString(record.version, "workspace read version")
  };
}
function parseWritten(body) {
  const record = requireRecord(body, "workspace write response");
  return { version: requireString(record.version, "workspace write version") };
}
var HttpWorkspaceProvider = class {
  /**
   * @param sessionId - Session whose workspace root the workbench reads and writes.
   */
  constructor(sessionId) {
    __publicField(this, "sessionId");
    this.sessionId = sessionId;
  }
  async list(path) {
    const params = new URLSearchParams({ sessionId: this.sessionId });
    if (path !== void 0 && path !== "") params.set("path", path);
    const response = await fetch(`${LIST_ROUTE}?${params.toString()}`, {
      headers: { accept: "application/json" }
    });
    return parseListing(await readJson(response, LIST_ROUTE));
  }
  async read(path) {
    const params = new URLSearchParams({ sessionId: this.sessionId, path });
    const response = await fetch(`${READ_ROUTE}?${params.toString()}`, {
      headers: { accept: "application/json" }
    });
    return parseFile(await readJson(response, READ_ROUTE));
  }
  async write(path, content) {
    const response = await fetch(WRITE_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sessionId: this.sessionId, path, content })
    });
    return parseWritten(await readJson(response, WRITE_ROUTE));
  }
  async mkdir(path) {
    await this.postOperation(MKDIR_ROUTE, "workspace mkdir response", { path });
  }
  async rename(from, to) {
    await this.postOperation(RENAME_ROUTE, "workspace rename response", { from, to });
  }
  async remove(path) {
    await this.postOperation(DELETE_ROUTE, "workspace delete response", { path });
  }
  /**
   * POST one file-tree operation for this Session.
   * @param route - workspace route path.
   * @param label - response description used in a malformed-body failure message.
   * @param fields - operation fields; the Session id is added.
   * @throws when the route fails or answers a non-object body.
   */
  async postOperation(route, label, fields) {
    const response = await fetch(route, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sessionId: this.sessionId, ...fields })
    });
    const body = requireRecord(await readJson(response, route), label);
    if (body.ok === false) {
      const detail = typeof body.error === "string" ? `: ${body.error}` : "";
      throw new Error(`${route} failed${detail}`);
    }
  }
};
function createWorkspaceProvider(sessionId) {
  return new HttpWorkspaceProvider(sessionId);
}

// velagent-css:D:\07_Code\Code\硬件学习\硬件学习总文件夹\AI尝试开发硬件\velxio开发\VelAgent\gaiZao\features\velagent-workbench\src\client\VelAgentOverlay.module.css
var css = "/* VelAgent workbench dock: a resizable right-hand panel inside the Harness shell. */\n\n.dock_4638ea {\n  position: fixed;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  z-index: 80;\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  background: var(--dsw-alias-bg-layer-1);\n  border-left: 0.5px solid var(--dsw-alias-border-l1);\n  box-shadow: var(--dsw-elevation-prominent);\n  color: var(--dsw-alias-label-primary);\n}\n\n.header_4638ea {\n  display: flex;\n  flex: none;\n  gap: 8px;\n  align-items: center;\n  min-height: 36px;\n  padding: 4px 10px;\n  border-bottom: 0.5px solid var(--dsw-alias-border-l1);\n}\n\n.brand_4638ea {\n  flex: none;\n  font-size: 13px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.status_4638ea {\n  display: inline-flex;\n  flex: none;\n  gap: 5px;\n  align-items: center;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  white-space: nowrap;\n}\n\n.dot_4638ea {\n  display: block;\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-idle-primary);\n}\n\n.dotConnected_4638ea {\n  background: var(--dsw-alias-state-success-primary);\n}\n\n.dotConnecting_4638ea {\n  background: var(--dsw-alias-state-warn-primary);\n}\n\n.dotClosed_4638ea {\n  background: var(--dsw-alias-state-idle-primary);\n}\n\n.dotError_4638ea {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n.spacer_4638ea {\n  flex: 1;\n}\n\n.control_4638ea {\n  flex: none;\n  height: 24px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  line-height: 22px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.control_4638ea:focus-visible {\n  border-color: var(--dsw-alias-border-l3);\n  color: var(--dsw-alias-label-primary);\n}\n\n@media (hover: hover) {\n  .control_4638ea:hover {\n    background: var(--dsw-alias-interactive-bg-hover);\n    color: var(--dsw-alias-label-primary);\n  }\n}\n\n.launcher_4638ea {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 28px;\n  padding: 0 10px;\n  border: 0.5px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-sm);\n  background: transparent;\n  color: inherit;\n  font-size: 12px;\n  line-height: 26px;\n  white-space: nowrap;\n  cursor: pointer;\n}\n\n.launcher_4638ea:focus-visible {\n  border-color: var(--dsw-alias-border-l3);\n}\n\n@media (hover: hover) {\n  .launcher_4638ea:hover {\n    background: var(--dsw-alias-interactive-bg-hover);\n  }\n}\n\n/* Explains why the workbench is unavailable, such as a pre-v3 embed build. */\n.notice_4638ea {\n  flex: none;\n  margin: 8px 10px 0;\n  padding: 8px 10px;\n  border: 0.5px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.body_4638ea {\n  position: relative;\n  flex: 1;\n  min-height: 0;\n  background: var(--dsw-alias-bg-base);\n}\n\n.workspace_4638ea {\n  position: absolute;\n  inset: 0;\n  overflow: hidden;\n}\n\n/* Covers the workbench while the embed loads, retries, or failed. */\n.placeholder_4638ea {\n  position: absolute;\n  inset: 0;\n  display: grid;\n  place-items: center;\n  padding: 16px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n  text-align: center;\n  pointer-events: none;\n}\n\n.resizeHandle_4638ea {\n  position: absolute;\n  top: 0;\n  bottom: 0;\n  left: -3px;\n  z-index: 1;\n  width: 7px;\n  cursor: col-resize;\n  touch-action: none;\n}\n";
if (typeof document !== "undefined" && document.querySelector("style[data-velagent-css]") === null) {
  const tag = document.createElement("style");
  tag.dataset.velagentCss = "gaiZao";
  tag.textContent = css;
  document.head.appendChild(tag);
}
var VelAgentOverlay_default = { "dock": "dock_4638ea", "header": "header_4638ea", "brand": "brand_4638ea", "status": "status_4638ea", "dot": "dot_4638ea", "dotConnected": "dotConnected_4638ea", "dotConnecting": "dotConnecting_4638ea", "dotClosed": "dotClosed_4638ea", "dotError": "dotError_4638ea", "spacer": "spacer_4638ea", "control": "control_4638ea", "launcher": "launcher_4638ea", "notice": "notice_4638ea", "body": "body_4638ea", "workspace": "workspace_4638ea", "placeholder": "placeholder_4638ea", "resizeHandle": "resizeHandle_4638ea" };

// src/client/VelAgentOverlay.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var DOCK_STORAGE_KEY = "velagent.dock";
var MIN_DOCK_WIDTH = 760;
var PREFERRED_DOCK_WIDTH = 1180;
var DEFAULT_DOCK_WIDTH_RATIO = 0.82;
var MAX_DOCK_WIDTH_RATIO = 0.9;
function maximumDockWidth() {
  return Math.round(window.innerWidth * MAX_DOCK_WIDTH_RATIO);
}
function preferredDockWidth() {
  return Math.min(PREFERRED_DOCK_WIDTH, Math.round(window.innerWidth * DEFAULT_DOCK_WIDTH_RATIO));
}
function clampDockWidth(width) {
  return Math.min(Math.max(Math.round(width), MIN_DOCK_WIDTH), maximumDockWidth());
}
function defaultDockPreferences() {
  return { width: clampDockWidth(preferredDockWidth()) };
}
function readStoredDock() {
  try {
    return window.localStorage.getItem(DOCK_STORAGE_KEY);
  } catch {
    return null;
  }
}
function parseDockPreferences(raw) {
  if (raw === null) return defaultDockPreferences();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultDockPreferences();
    const record = parsed;
    return typeof record.width === "number" && Number.isFinite(record.width) ? { width: clampDockWidth(record.width) } : defaultDockPreferences();
  } catch {
    return defaultDockPreferences();
  }
}
function writeDockPreferences(preferences) {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
  }
}
function statusPresentation(status, t) {
  switch (status) {
    case "connected":
      return { label: t("status.connected"), dot: VelAgentOverlay_default.dotConnected };
    case "connecting":
      return { label: t("status.connecting"), dot: VelAgentOverlay_default.dotConnecting };
    case "closed":
      return { label: t("status.closed"), dot: VelAgentOverlay_default.dotClosed };
    case "error":
      return { label: t("status.error"), dot: VelAgentOverlay_default.dotError };
  }
}
function VelAgentOverlay({ sessionId, t, onClose, sendTrialPrompt }) {
  const [dock, setDock] = (0, import_react.useState)(() => parseDockPreferences(readStoredDock()));
  const [canvasState, setCanvasState] = (0, import_react.useState)({ status: "closed", capabilities: NO_CAPABILITIES });
  const containerRef = (0, import_react.useRef)(null);
  const dragRef = (0, import_react.useRef)(null);
  const widthRef = (0, import_react.useRef)(dock.width);
  const sendTrialRef = (0, import_react.useRef)(sendTrialPrompt);
  const status = canvasState.status;
  const presentation = statusPresentation(status, t);
  const hasAiRun = sendTrialPrompt !== void 0;
  const legacyEmbed = status === "connected" && !canvasState.capabilities.workspace;
  (0, import_react.useEffect)(() => {
    sendTrialRef.current = sendTrialPrompt;
  }, [sendTrialPrompt]);
  (0, import_react.useEffect)(() => {
    const container = containerRef.current;
    if (container === null) return;
    const bridge = createCanvasSync(sessionId === void 0 ? {} : { sessionId });
    const unsubscribe = bridge.subscribeState((state) => {
      setCanvasState(state);
    });
    setCanvasState(bridge.getState());
    const onAiRun = hasAiRun ? () => {
      const send = sendTrialRef.current;
      if (send === void 0) return;
      send().catch((error) => {
        console.warn("[velagent] AI run injection failed", error);
      });
    } : void 0;
    const workspace = sessionId === void 0 ? void 0 : createWorkspaceProvider(sessionId);
    bridge.attach(container, {
      ...onAiRun === void 0 ? {} : { onAiRun },
      ...workspace === void 0 ? {} : { workspace }
    });
    return () => {
      unsubscribe();
      bridge.dispose();
    };
  }, [sessionId, hasAiRun]);
  (0, import_react.useEffect)(() => {
    const handleMove = (event) => {
      const drag = dragRef.current;
      if (drag === null) return;
      const width = clampDockWidth(drag.startWidth + (drag.startX - event.clientX));
      widthRef.current = width;
      setDock((current) => current.width === width ? current : { ...current, width });
    };
    const handleEnd = () => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      writeDockPreferences({ width: widthRef.current });
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);
  const startResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        role: "complementary",
        "aria-label": t("dock.aria"),
        className: VelAgentOverlay_default.dock,
        style: { width: dock.width },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "div",
            {
              className: VelAgentOverlay_default.resizeHandle,
              role: "separator",
              "aria-orientation": "vertical",
              "aria-label": t("dock.resizeAria"),
              onPointerDown: startResize
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: VelAgentOverlay_default.header, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { className: VelAgentOverlay_default.brand, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\u26A1 " }),
              t("dock.title")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: VelAgentOverlay_default.status, "data-status": status, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${VelAgentOverlay_default.dot} ${presentation.dot ?? ""}`, "aria-hidden": "true" }),
              presentation.label
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: VelAgentOverlay_default.spacer }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: VelAgentOverlay_default.control, onClick: onClose, children: t("dock.close") })
          ] }),
          legacyEmbed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: VelAgentOverlay_default.notice, role: "status", children: t("workspace.legacy") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: VelAgentOverlay_default.body, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: containerRef, className: VelAgentOverlay_default.workspace }),
            status !== "connected" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: VelAgentOverlay_default.placeholder, "data-status": status, children: status === "error" ? t("canvas.error") : t("canvas.loading") }) : null
          ] })
        ]
      }
    ),
    document.body
  );
}
function VelAgentHeaderButton({ sessionId, t, sendTrialPrompt }) {
  const [open, setOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: VelAgentOverlay_default.launcher,
        title: t("launcher.header.title"),
        onClick: () => {
          setOpen(true);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\u26A1" }),
          t("launcher.header.label")
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      VelAgentOverlay,
      {
        sessionId,
        t,
        sendTrialPrompt,
        onClose: () => {
          setOpen(false);
        }
      }
    ) : null
  ] });
}
function VelAgentFooterButton({ t }) {
  const [open, setOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: VelAgentOverlay_default.launcher,
        title: t("launcher.footer.title"),
        onClick: () => {
          setOpen(true);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", children: "\u26A1" }),
          t("launcher.footer.label")
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VelAgentOverlay, { sessionId: void 0, t, onClose: () => {
      setOpen(false);
    } }) : null
  ] });
}

// src/client/locales.ts
var NS = "velagent";
var zh = {
  "launcher.header.label": "VelAgent \u5DE5\u4F5C\u53F0",
  "launcher.header.title": "\u6253\u5F00 VelAgent \u5DE5\u4F5C\u53F0",
  "launcher.footer.label": "VelAgent",
  "launcher.footer.title": "\u6253\u5F00 VelAgent \u5DE5\u4F5C\u53F0",
  "dock.title": "VelAgent \u5DE5\u4F5C\u53F0",
  "dock.aria": "VelAgent \u5DE5\u4F5C\u53F0",
  "dock.close": "\u5173\u95ED",
  "dock.resizeAria": "\u62D6\u52A8\u8C03\u6574\u9762\u677F\u5BBD\u5EA6",
  "status.connected": "\u5DF2\u8FDE\u63A5",
  "status.connecting": "\u8FDE\u63A5\u4E2D",
  "status.closed": "\u672A\u8FDE\u63A5",
  "status.error": "\u9519\u8BEF",
  "canvas.loading": "\u6B63\u5728\u52A0\u8F7D VelAgent \u5DE5\u4F5C\u53F0\u2026",
  "canvas.error": "\u5DE5\u4F5C\u53F0\u52A0\u8F7D\u5931\u8D25\uFF0C\u5173\u95ED\u540E\u91CD\u65B0\u6253\u5F00\u53EF\u91CD\u8BD5\u3002",
  "workspace.legacy": "\u5F53\u524D VelAgent \u753B\u5E03\u7EC4\u4EF6\u4E3A\u65E7\u7248\u672C\uFF0C\u4EC5\u663E\u793A\u7535\u8DEF\u753B\u5E03\uFF1B\u66F4\u65B0 VelAgent \u540E\u53EF\u4F7F\u7528\u5B8C\u6574\u5DE5\u4F5C\u53F0\u3002",
  "aiRun.prompt": "\u73B0\u5728\u5BF9\u672C\u8F6E\u505A\u4E00\u6B21\u65B0\u7684\u8BD5\u8FD0\u884C\uFF0C\u4E0D\u8981\u5F15\u7528\u5386\u53F2\u7ED3\u679C\uFF1A1) \u5FC5\u987B\u8C03\u7528 velagent_read_circuit\uFF08full:true\uFF09\u8BFB\u53D6\u5F53\u524D\u753B\u5E03\uFF1B2) \u5FC5\u987B\u8C03\u7528 velagent_read_code \u8BFB\u53D6\u5F53\u524D\u4EE3\u7801\uFF1B3) \u4F9D\u636E\u4EE3\u7801\u91CC\u7684 digitalWrite/delay/Serial \u751F\u6210\u65F6\u95F4\u8F74\uFF0C\u5E76\u8C03\u7528 velagent_play_timeline \u64AD\u653E\uFF1B4) \u6700\u540E\u7528\u4E2D\u6587\u7B80\u77ED\u8BF4\u660E\u8FD0\u884C\u7ED3\u679C\u3002\u4EFB\u4F55\u5DE5\u5177\u62A5\u9519\u8BF7\u628A\u539F\u59CB\u9519\u8BEF\u4FE1\u606F\u8D34\u51FA\u6765\u3002"
};
var en = {
  "launcher.header.label": "VelAgent workbench",
  "launcher.header.title": "Open the VelAgent workbench",
  "launcher.footer.label": "VelAgent",
  "launcher.footer.title": "Open the VelAgent workbench",
  "dock.title": "VelAgent workbench",
  "dock.aria": "VelAgent workbench",
  "dock.close": "Close",
  "dock.resizeAria": "Resize the panel",
  "status.connected": "Connected",
  "status.connecting": "Connecting",
  "status.closed": "Disconnected",
  "status.error": "Error",
  "canvas.loading": "Loading the VelAgent workbench\u2026",
  "canvas.error": "The workbench failed to load. Close and reopen the dock to retry.",
  "workspace.legacy": "This VelAgent build is older and shows the circuit canvas only. Update VelAgent to use the full workbench.",
  "aiRun.prompt": "Run a fresh trial now and ignore earlier results: 1) you must call velagent_read_circuit (full:true) for the current canvas; 2) you must call velagent_read_code for the current code; 3) derive a timeline from digitalWrite/delay/Serial and call velagent_play_timeline; 4) explain the outcome briefly in Chinese. Paste any raw tool error verbatim."
};

// src/client/index.ts
function isClientSessions(value) {
  if (typeof value !== "object" || value === null) return false;
  return typeof value.scope === "function";
}
function clientSessions(ctx) {
  const value = ctx.get("sessions");
  if (!isClientSessions(value)) throw new Error("ui-velagent: client Sessions service unavailable");
  return value;
}
var inject = ["slots", "locale", "sessions"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-velagent: dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "velagent-workbench",
    locale: NS,
    inject: (sessionId) => ({
      sendTrialPrompt: async () => {
        const scoped = clientSessions(ctx).scope(sessionId);
        if (scoped === void 0) throw new Error(`ui-velagent: session "${String(sessionId)}" resolved no scope`);
        const conversation = scoped.get("conversation");
        if (conversation === void 0) throw new Error("ui-velagent: conversation service unavailable");
        await conversation.send(t("aiRun.prompt"));
      }
    })
  }, VelAgentHeaderButton));
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "velagent",
    locale: NS
  }, VelAgentFooterButton));
}

    })(module, exports, require);
    return module.exports;
  },
});