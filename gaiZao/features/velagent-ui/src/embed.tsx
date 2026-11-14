/**
 * VelAgent 的可嵌入入口：DSH 插件在右侧 dock 里原生挂载画布 / 代码编辑器，
 * 不走 iframe / 独立窗口，也不需要额外端口或 token。
 *
 * 加载 embed-dist/velagent-embed.js 后通过 `window.VelAgentEmbed` 使用，
 * 接口见 VelAgent/docs/canvas-bridge-contract.md §1。
 * v3：mountWorkspace 挂载独立版原样工作台（品牌头 + 活动栏 + 文件树 +
 * Monaco/画布分栏 + 状态栏）；v2 的 mount/mountEditor/代码读写/时间轴
 * 播放/项目导出全部保留。
 */
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import './index.css';
// 独立版品牌皮肤（活动栏 / 状态栏 / 品牌头的 --va-* 样式），工作台挂载需要。
import './va-theme.css';
// 嵌入工作台的作用域 reset（见 embed-workspace.css 注释）。
import './embed-workspace.css';
import './i18n';
import { markProBoardsSettled } from './lib/proBoardRegistry';
import { EditorPage } from './pages/EditorPage';
import { SimulatorCanvas } from './components/simulator/SimulatorCanvas';
import { EmbedEditorView } from './components/editor/EmbedEditorView';
import './components/velxio-components/IC74HC595';
import './components/velxio-components/LogicGateElements';
import './components/velxio-components/TransistorElements';
import './components/velxio-components/OpAmpElements';
import './components/velxio-components/PowerElements';
import './components/velxio-components/DiodeElements';
import './components/velxio-components/RelayElements';
import './components/velxio-components/LogicICElements';
import './components/velxio-components/MotorDriverElements';
import './components/velxio-components/FlipFlopElements';
import './components/velxio-components/RaspberryPi3Element';
import './components/velxio-components/Bmp280Element';
import './components/velxio-components/Ds3231Element';
import './components/velxio-components/GpsNeo6mElement';
import './components/velxio-components/EPaperElement';
import { useSimulatorStore } from './store/useSimulatorStore';
import { executeCommand as runCanvasCommand } from './integration/commands';
import { getCode as readCode, setCode as writeCode, type CodeSnapshot } from './integration/editorCode';
import { playTimeline as startTimeline, type Playbook } from './integration/playback';
import { exportProject as downloadProject } from './integration/projectExport';
import {
  bumpWorkspaceRevision,
  serializeWorkspace,
  type WorkspaceSnapshot,
} from './integration/workspaceState';
import type { WorkspaceProvider } from './integration/workspaceProvider';

// 契约 §1 的 WorkspaceProvider 相关类型随 API 一起导出，方便 dock 侧类型对齐。
export type {
  WorkspaceFileEntry,
  WorkspaceListing,
  WorkspaceProvider,
  WorkspaceReadResult,
  WorkspaceWriteResult,
} from './integration/workspaceProvider';

// Monaco 走插件宿主提供的静态资源路由 /velagent-assets/monaco/vs（由
// velagent-workbench 宿主从 gaiZao/features/velagent-ui/embed-dist 发出）。
// 这里必须用绝对路径——embed 页面挂在 Harness 根路径下，不能用相对路径。
// monaco 本身不打进 IIFE：@monaco-editor/react 通过 AMD loader 在运行时拉取。
loader.config({ paths: { vs: '/velagent-assets/monaco/vs' } });

/** 画布命令，结构见 canvas-bridge-contract.md §4。 */
export type CanvasCommand = Record<string, unknown>;

/** 一条命令的执行结果：命令自身返回值 + 执行后的最新快照。 */
export interface CommandExecution {
  result: unknown;
  workspace: WorkspaceSnapshot;
}

/** 行为时间轴剧本（与 canvas-bridge-contract.md §1 的 TimelinePlaybook 一致）。 */
export interface TimelinePlaybook {
  timeline: Playbook['timeline'];
  explain?: string;
  warnings?: string[];
}

/** mountWorkspace 的选项。 */
export interface MountWorkspaceOptions {
  /**
   * 嵌入模式「AI 运行」按钮的回调：由 Harness 插件注入，把试运行 prompt 发给
   * Harness 里的模型（模型再调用 velagent_* 工具）。省略时工作台回退本地规则预测。
   */
  onAiRun?: () => void;
  /**
   * Harness 会话真实工作区（契约 §1 WorkspaceProvider）。提供后工作台左侧文件树
   * 显示该工作区、读写走 provider；省略时保持独立版内置文件树行为。
   */
  workspace?: WorkspaceProvider;
}

/** `window.VelAgentEmbed` 的完整接口（契约 v3）。 */
export interface VelAgentEmbedApi {
  /** 协议版本；有不兼容改动时递增。 */
  version: 3;
  /**
   * 把独立版原样工作台（品牌头 + 活动栏 + 文件树 + Monaco/画布分栏 + 状态栏）
   * 挂到容器里，返回卸载函数。Harness dock 首选入口。
   */
  mountWorkspace(element: HTMLElement, options?: MountWorkspaceOptions): () => void;
  /** 把电路画布挂到容器里，返回卸载函数（同一页面可有多个挂载点）。 */
  mount(element: HTMLElement): () => void;
  /** 把代码编辑器（Monaco + 文件标签）挂到容器里，返回卸载函数。 */
  mountEditor(element: HTMLElement): () => void;
  /** 当前工作区快照（纯 JSON，可结构化克隆）。 */
  getState(): WorkspaceSnapshot;
  /** 执行一条画布命令，返回命令结果与执行后的最新快照。 */
  executeCommand(command: CanvasCommand): Promise<CommandExecution>;
  /** 画布状态变化订阅（内部已去抖），返回取消订阅函数。 */
  subscribe(listener: (state: WorkspaceSnapshot) => void): () => void;
  /** 当前编辑器代码：活动文件名 + 全部文件。 */
  getCode(): CodeSnapshot;
  /** 写入代码：name 省略时写当前活动文件；返回实际文件名。 */
  setCode(update: { name?: string; content: string }): Promise<{ name: string }>;
  /** 播放一段行为时间轴（LED/串口），返回停止函数。 */
  playTimeline(playbook: TimelinePlaybook): { stop: () => void };
  /** 把当前项目导出成 .vlx 文件（浏览器下载），返回实际文件名。 */
  exportProject(options?: { name?: string }): { name: string };
}

/** 状态变化的去抖窗口；批量命令执行期间的多次 store 变更合并成一次回调。 */
const CHANGE_DEBOUNCE_MS = 100;

/** 每个挂载容器的 React root，按容器管理，互不影响。 */
const canvasMounts = new Map<HTMLElement, Root>();
const editorMounts = new Map<HTMLElement, Root>();
const workspaceMounts = new Map<HTMLElement, Root>();

let debounceTimer: number | undefined;
let storeUnsubscribe: (() => void) | null = null;
const listeners = new Set<(state: WorkspaceSnapshot) => void>();

function flushListeners(): void {
  debounceTimer = undefined;
  if (listeners.size === 0) return;
  const state = serializeWorkspace();
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch (err) {
      console.warn('[velagent] embed subscriber failed', err);
    }
  }
}

/** 每次 store 变更推进版本号；去抖只合并回调，不合并版本。 */
function onStoreChange(): void {
  bumpWorkspaceRevision();
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(flushListeners, CHANGE_DEBOUNCE_MS);
}

/** 停掉去抖定时器；最后一个订阅者取消时再摘掉 store 订阅。 */
function detachStore(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = undefined;
  storeUnsubscribe?.();
  storeUnsubscribe = null;
}

/** 准备一个挂载容器：清空内容并打上 CSS 作用域锚点。 */
function prepareContainer(element: HTMLElement, dataAttributes?: Record<string, string>): void {
  element.innerHTML = '';
  // 作用域锚点：清理后的全局规则（如 focus-visible）只命中画布/编辑器内部。
  element.dataset.velxioEmbed = '1';
  if (dataAttributes) {
    for (const [key, value] of Object.entries(dataAttributes)) element.dataset[key] = value;
  }
}

/** 把一个 React 组件挂到容器；重复挂载同一容器时复用已有 root。 */
function mountComponent(
  element: HTMLElement,
  registry: Map<HTMLElement, Root>,
  render: () => ReactNode,
  dataAttributes?: Record<string, string>,
): () => void {
  let root = registry.get(element);
  if (!root) {
    prepareContainer(element, dataAttributes);
    root = createRoot(element);
    registry.set(element, root);
    root.render(render());
  }
  const mounted = root;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (registry.get(element) !== mounted) return;
    registry.delete(element);
    mounted.unmount();
  };
}

/** 把 VelAgent 电路画布挂载到给定容器，返回卸载函数。 */
export function mount(element: HTMLElement): () => void {
  markProBoardsSettled();
  return mountComponent(element, canvasMounts, () => <SimulatorCanvas />);
}

/**
 * 把独立版原样工作台挂到容器里（Harness dock 的默认入口）。
 * @param element - 容器；需要由调用方给出高度（dock 面板 inset:0）。
 * @param options - onAiRun：嵌入模式下「AI 运行」按钮的回调。
 * @returns 卸载函数（卸载 React root 并清空容器渲染内容）。
 */
export function mountWorkspace(element: HTMLElement, options?: MountWorkspaceOptions): () => void {
  markProBoardsSettled();
  const onAiRun = options?.onAiRun;
  const workspace = options?.workspace;
  return mountComponent(
    element,
    workspaceMounts,
    () => <EditorPage embedded onAiRun={onAiRun} workspace={workspace} />,
    { velxioWorkspace: '1' },
  );
}

/** 把代码编辑器（Monaco + 文件标签栏）挂载到给定容器，返回卸载函数。 */
export function mountEditor(element: HTMLElement): () => void {
  return mountComponent(element, editorMounts, () => <EmbedEditorView />);
}

/** @returns 当前画布快照（与 getState 相同）。 */
export function getState(): WorkspaceSnapshot {
  return serializeWorkspace();
}

/** 执行画布命令（含 code_get/code_set/timeline_play/timeline_stop/export_project）；失败时 reject。 */
export async function executeCommand(command: CanvasCommand): Promise<CommandExecution> {
  const outcome = await runCanvasCommand(command);
  return { result: outcome.result ?? null, workspace: outcome.workspace };
}

/**
 * 订阅画布状态变化（100ms 去抖）。回调收到的是可结构化克隆的快照。
 * @returns 取消订阅函数。
 */
export function subscribe(listener: (state: WorkspaceSnapshot) => void): () => void {
  listeners.add(listener);
  if (!storeUnsubscribe) storeUnsubscribe = useSimulatorStore.subscribe(onStoreChange);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachStore();
  };
}

/** @returns 编辑器当前代码（活动文件名 + 全部文件）。 */
export function getCode(): CodeSnapshot {
  return readCode();
}

/**
 * 写入编辑器代码。
 * @param update - name（省略写当前活动文件）与 content。
 * @returns 实际写入的文件名。
 */
export async function setCode(update: { name?: string; content: string }): Promise<{ name: string }> {
  return writeCode(update);
}

/**
 * 播放一段行为时间轴；同一时间只保留一段，新播放会先停掉旧的。
 * @param playbook - 时间轴剧本。
 * @returns stop：停止播放并熄灭 LED。
 */
export function playTimeline(playbook: TimelinePlaybook): { stop: () => void } {
  const { stop } = startTimeline(playbook);
  return { stop };
}

/**
 * 导出当前项目为 .vlx 文件（浏览器下载）。
 * @param options - name：文件名（不含 .vlx 后缀）。
 * @returns name：浏览器实际使用的文件名。
 */
export function exportProject(options: { name?: string } = {}): { name: string } {
  return downloadProject(options);
}

/** 暴露给 DSH 插件加载的全局入口。 */
declare global {
  interface Window {
    VelAgentEmbed?: VelAgentEmbedApi;
  }
}

const embedApi: VelAgentEmbedApi = {
  version: 3,
  mountWorkspace,
  mount,
  mountEditor,
  getState,
  executeCommand,
  subscribe,
  getCode,
  setCode,
  playTimeline,
  exportProject,
};
window.VelAgentEmbed = embedApi;
