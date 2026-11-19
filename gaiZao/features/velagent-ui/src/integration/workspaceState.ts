/**
 * 画布工作区快照（纯 JSON）：桌面端桥接、浏览器端 embed、DSH 宿主插件共用。
 *
 * 本模块刻意不 import `@tauri-apps/api`：embed 包（velagent-embed.js）会直接
 * 引用它，不能把桌面端 Tauri 桥接拖进浏览器 bundle。
 * 协议见 VelAgent/docs/canvas-bridge-contract.md §1。
 */
import { useSimulatorStore } from '../store/useSimulatorStore';

/** 与 canvas-bridge-contract.md §1 的 `WorkspaceSnapshot` 一致。 */
export interface WorkspaceSnapshot {
  revision: number;
  name: string;
  boards: Array<{
    id: string;
    kind: string;
    x: number;
    y: number;
    rotation: number;
    name?: string;
    /** 面向人和 AI 的变量名（U1 / B1 …）。 */
    ref?: string;
  }>;
  components: Array<{
    id: string;
    metadata_id: string;
    x: number;
    y: number;
    rotation: number;
    properties: Record<string, unknown>;
    /** 面向人和 AI 的变量名（R1 / D1 …）。 */
    ref?: string;
  }>;
  wires: Array<{
    id: string;
    from: { owner_id: string; pin: string };
    to: { owner_id: string; pin: string };
    color: string;
    signal?: string;
  }>;
}

/**
 * 当前工作区版本号：每次画布状态变化加 1。
 *
 * 桥接协议用它判断快照是否变化（客户端据此决定是否推给 Harness 宿主），
 * 所以只在浏览器 embed 的 store 订阅里推进；桌面端由 Rust 侧的镜像版本维护。
 */
let revision = 0;

/**
 * 标记画布状态已变化。
 * @returns 新的工作区版本号。
 */
export function bumpWorkspaceRevision(): number {
  revision += 1;
  return revision;
}

/** @returns 当前画布的可结构化克隆快照（纯 JSON，无循环引用）。 */
export function serializeWorkspace(): WorkspaceSnapshot {
  const s = useSimulatorStore.getState();
  return {
    revision,
    name: 'workspace',
    boards: s.boards.map((b) => ({
      id: b.id,
      kind: b.boardKind,
      x: b.x,
      y: b.y,
      rotation: b.rotation ?? 0,
      name: b.name,
      ...(b.ref ? { ref: b.ref } : {}),
    })),
    components: s.components.map((c) => ({
      id: c.id,
      metadata_id: c.metadataId,
      x: c.x,
      y: c.y,
      rotation: Number((c.properties as Record<string, unknown>)?.rotation) || 0,
      properties: c.properties ?? {},
      ...(typeof c.properties?.ref === 'string' ? { ref: c.properties.ref } : {}),
    })),
    wires: s.wires.map((w) => ({
      id: w.id,
      from: { owner_id: w.start.componentId, pin: w.start.pinName },
      to: { owner_id: w.end.componentId, pin: w.end.pinName },
      color: w.color,
      signal: w.signalType,
    })),
  };
}
