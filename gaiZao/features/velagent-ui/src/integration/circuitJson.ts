/**
 * 电路 JSON：画布 ⇄ JSON 的唯一转换层。
 *
 * 格式（中文键，人和 AI 共用同一份）：
 *   {
 *     版本: 1,
 *     名称: string,
 *     元件: [{ 编号, 型号, 位置? | 插在?, 参数?, 旋转? }],
 *     连线: [{ 起点: "编号.引脚", 终点: "编号.引脚", 颜色? }],
 *     网络?: [{ 名称?, 引脚: ["编号.引脚", …] }]
 *   }
 *
 * 规则：每条连接只写一遍；元件之间不嵌套；面包板孔用用户坐标（a5 / tp.1），
 * 内部名（5t.a）只出现在画布状态里。写入画布时先整体校验，失败不动画布。
 */
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { ComponentRegistry } from '../lib/ComponentRegistry';
import { isKnownBoardKind } from '../types/board';
import type { BoardInstance, BoardKind } from '../types/board';
import type { Component } from '../types/component';
import type { Wire } from '../types/wire';
import { generateUUID } from '../utils/uuid';
import { autoWireColor } from '../utils/wireUtils';
import { BREADBOARD_PINS } from '../velxio-elements/breadboard-element';
import { BREADBOARD_MINI_PINS } from '../velxio-elements/breadboard-mini-element';
import { breadboardGroupKey } from '../utils/breadboardNets';
import {
  breadboardHoleName,
  breadboardPinName,
  isBreadboardMetadata,
  resolvePinName,
} from '../utils/pinNames';

/** JSON 里的一个元件 / 板卡。 */
export interface CircuitJsonPart {
  编号: string;
  型号: string;
  位置?: [number, number];
  插在?: Record<string, string>;
  参数?: Record<string, unknown>;
  旋转?: number;
}

/** JSON 里的一根导线。 */
export interface CircuitJsonWire {
  起点: string;
  终点: string;
  颜色?: string;
}

/** JSON 里的一根电气网络（由画布推导，可选）。 */
export interface CircuitJsonNet {
  名称?: string;
  引脚: string[];
}

/** 电路 JSON 文档。 */
export interface CircuitJson {
  版本: number;
  名称: string;
  元件: CircuitJsonPart[];
  连线: CircuitJsonWire[];
  网络?: CircuitJsonNet[];
}

/** 当前画布上的一个归属物（板卡或元件）。 */
interface Owner {
  id: string;
  ref: string;
  metadataId: string;
  /** 板卡给 boardKind，元件给 metadataId（供引脚 / 面包板规则判断）。 */
  kind: 'board' | 'component';
}

const CIRCUIT_JSON_VERSION = 1;

const REF_PREFIX: Record<string, string> = {
  breadboard: 'B',
  'breadboard-mini': 'B',
  led: 'D',
  'rgb-led': 'D',
  'led-ring': 'D',
  neopixel: 'D',
  resistor: 'R',
  capacitor: 'C',
  'capacitor-electrolytic': 'C',
  inductor: 'L',
  pushbutton: 'S',
  'push-button': 'S',
  buzzer: 'BZ',
  servo: 'M',
  'servo-motor': 'M',
  potentiometer: 'RV',
  'slide-potentiometer': 'RV',
};

/** 型号 → 变量名前缀（R1 / D1 / B1 …）。 */
function refPrefix(metadataId: string): string {
  const known = REF_PREFIX[metadataId];
  if (known) return known;
  const letters = metadataId.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
  return letters || 'X';
}

/** 取下一个未被占用的变量名。 */
function nextRef(prefix: string, used: Set<string>): string {
  for (let index = 1; index < 10000; index += 1) {
    const candidate = prefix + index;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = 'X' + Date.now().toString(36).toUpperCase();
  used.add(fallback);
  return fallback;
}

/** 读出某个元件已经存在的变量名。 */
function boardRefOf(board: BoardInstance): string | undefined {
  return typeof board.ref === 'string' && board.ref.trim() ? board.ref.trim() : undefined;
}

/** 读出某个元件已经存在的变量名（存在 properties.ref）。 */
function componentRefOf(component: Component): string | undefined {
  const value = component.properties?.ref;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 确保画布上每个板卡 / 元件都有唯一变量名；缺的自动补上并写回 store。
 * @returns 板卡 id → 变量名、元件 id → 变量名两张表。
 */
export function ensureRefs(): {
  board: Map<string, string>;
  component: Map<string, string>;
} {
  const store = useSimulatorStore.getState();
  const used = new Set<string>();
  const boardRefs = new Map<string, string>();
  const componentRefs = new Map<string, string>();
  for (const board of store.boards) {
    const ref = boardRefOf(board);
    if (ref && !used.has(ref)) {
      used.add(ref);
      boardRefs.set(board.id, ref);
    }
  }
  for (const component of store.components) {
    const ref = componentRefOf(component);
    if (ref && !used.has(ref) && !boardRefs.has(component.id)) {
      used.add(ref);
      componentRefs.set(component.id, ref);
    }
  }
  for (const board of store.boards) {
    if (boardRefs.has(board.id)) continue;
    const ref = nextRef('U', used);
    boardRefs.set(board.id, ref);
    store.updateBoard(board.id, { ref });
  }
  for (const component of store.components) {
    if (componentRefs.has(component.id)) continue;
    const ref = nextRef(refPrefix(component.metadataId), used);
    componentRefs.set(component.id, ref);
    store.updateComponent(component.id, {
      properties: { ...component.properties, ref },
    });
  }
  return { board: boardRefs, component: componentRefs };
}

/**
 * 给一块新板卡分配变量名（保留用户已设置的名字）。
 * @param boardId - 板卡画布 id。
 * @returns 变量名；板卡不存在时返回 null。
 */
export function assignBoardRef(boardId: string): string | null {
  const board = useSimulatorStore.getState().boards.find((item) => item.id === boardId);
  if (!board) return null;
  const refs = ensureRefs();
  return refs.board.get(boardId) ?? null;
}

/**
 * 给一个新元件分配变量名（保留用户已设置的名字）。
 * @param componentId - 元件画布 id。
 * @returns 变量名；元件不存在时返回 null。
 */
export function assignComponentRef(componentId: string): string | null {
  const component = useSimulatorStore.getState().components.find((item) => item.id === componentId);
  if (!component) return null;
  const refs = ensureRefs();
  return refs.component.get(componentId) ?? null;
}

/** 建立一个 owner 索引（按变量名和按 id 都能查）。 */
function ownerIndex(): { byRef: Map<string, Owner>; byId: Map<string, Owner> } {
  const store = useSimulatorStore.getState();
  const byRef = new Map<string, Owner>();
  const byId = new Map<string, Owner>();
  for (const board of store.boards) {
    const ref = boardRefOf(board);
    if (!ref) continue;
    const owner: Owner = { id: board.id, ref, metadataId: board.boardKind, kind: 'board' };
    byRef.set(ref, owner);
    byId.set(board.id, owner);
  }
  for (const component of store.components) {
    const ref = componentRefOf(component);
    if (!ref) continue;
    const owner: Owner = {
      id: component.id,
      ref,
      metadataId: component.metadataId,
      kind: 'component',
    };
    byRef.set(ref, owner);
    byId.set(component.id, owner);
  }
  return { byRef, byId };
}

/** 元件的可选参数（只导出类型目录里声明过的字段，外加常用 color）。 */
function paramsOf(component: Component): Record<string, unknown> | undefined {
  const meta = ComponentRegistry.getInstance().getById(component.metadataId);
  const declared = new Set<string>((meta?.properties ?? []).map((property) => property.name));
  const defaults = (meta?.defaultValues ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(component.properties ?? {})) {
    if (key === 'ref' || key === 'rotation' || key === 'state') continue;
    if (!declared.has(key) && key !== 'color') continue;
    if (value === undefined || value === null) continue;
    // 和型号默认值一样的参数不导出，保证 JSON 往返幂等。
    if (Object.prototype.hasOwnProperty.call(defaults, key)) {
      const fallback = defaults[key];
      if (String(fallback) === String(value)) continue;
      if (typeof fallback === 'boolean' && typeof value === 'boolean' && fallback === value) continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 元件插在面包板上的孔位（来自隐藏的 bb 连线）。 */
function seatOf(
  componentId: string,
  bbWires: Wire[],
  byId: Map<string, Owner>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const wire of bbWires) {
    const partSide =
      wire.start.componentId === componentId ? wire.start : wire.end.componentId === componentId ? wire.end : null;
    if (!partSide) continue;
    const holeSide = partSide === wire.start ? wire.end : wire.start;
    const partOwner = byId.get(partSide.componentId);
    const holeOwner = byId.get(holeSide.componentId);
    if (!partOwner || !holeOwner) continue;
    // 面包板不是"插在别人身上"的零件；孔必须真的属于面包板。
    if (isBreadboardMetadata(partOwner.metadataId)) continue;
    if (!isBreadboardMetadata(holeOwner.metadataId)) continue;
    out[partSide.pinName] = holeOwner.ref + '.' + breadboardPinName(holeSide.pinName);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 两个引脚之间的并查集，用来推导网络表。 */
class UnionFind {
  private parent = new Map<string, string>();

  find(key: string): string {
    const parent = this.parent.get(key);
    if (parent === undefined) {
      this.parent.set(key, key);
      return key;
    }
    if (parent === key) return key;
    const root = this.find(parent);
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

/** 从画布状态生成电路 JSON（不改变画布以外的任何东西）。 */
export function buildCircuitJson(): CircuitJson {
  const refs = ensureRefs();
  const store = useSimulatorStore.getState();
  const byId = new Map<string, Owner>();
  for (const board of store.boards) {
    const ref = refs.board.get(board.id);
    if (ref) byId.set(board.id, { id: board.id, ref, metadataId: board.boardKind, kind: 'board' });
  }
  for (const component of store.components) {
    const ref = refs.component.get(component.id);
    if (ref) {
      byId.set(component.id, {
        id: component.id,
        ref,
        metadataId: component.metadataId,
        kind: 'component',
      });
    }
  }

  const parts: CircuitJsonPart[] = [];
  for (const board of store.boards) {
    const owner = byId.get(board.id);
    if (!owner) continue;
    const part: CircuitJsonPart = {
      编号: owner.ref,
      型号: board.boardKind,
      位置: [Math.round(board.x), Math.round(board.y)],
    };
    const rotation = Math.round(((Number(board.rotation) || 0) + 360) % 360);
    if (rotation !== 0) part.旋转 = rotation;
    parts.push(part);
  }

  const bbWires = store.wires.filter((wire) => wire.bb === true);
  for (const component of store.components) {
    const owner = byId.get(component.id);
    if (!owner) continue;
    const part: CircuitJsonPart = { 编号: owner.ref, 型号: component.metadataId };
    const seat = seatOf(component.id, bbWires, byId);
    if (seat) {
      part.插在 = seat;
    } else {
      part.位置 = [Math.round(component.x), Math.round(component.y)];
    }
    const rotation = Math.round(((Number(component.properties?.rotation) || 0) + 360) % 360);
    if (rotation !== 0) part.旋转 = rotation;
    const params = paramsOf(component);
    if (params) part.参数 = params;
    parts.push(part);
  }

  const wires: CircuitJsonWire[] = [];
  for (const wire of store.wires) {
    if (wire.bb) continue;
    const from = byId.get(wire.start.componentId);
    const to = byId.get(wire.end.componentId);
    if (!from || !to) continue;
    const row: CircuitJsonWire = {
      起点: from.ref + '.' + (isBreadboardMetadata(from.metadataId) ? breadboardPinName(wire.start.pinName) : wire.start.pinName),
      终点: to.ref + '.' + (isBreadboardMetadata(to.metadataId) ? breadboardPinName(wire.end.pinName) : wire.end.pinName),
    };
    if (wire.color) row.颜色 = wire.color;
    wires.push(row);
  }

  return {
    版本: CIRCUIT_JSON_VERSION,
    名称: 'workspace',
    元件: parts,
    连线: wires,
    网络: buildNets(store.wires, byId),
  };
}

/** @returns 画布电路 JSON 的格式化文本（面板里展示的就是它）。 */
export function circuitJsonText(): string {
  return JSON.stringify(buildCircuitJson(), null, 2);
}

/** 推导电气网络：导线 + 面包板内部同列 / 电源轨连通。 */
function buildNets(wires: Wire[], byId: Map<string, Owner>): CircuitJsonNet[] {
  const uf = new UnionFind();
  const keyOf = (componentId: string, pinName: string): string => componentId + '::' + pinName;
  const visibleEndpoints = new Set<string>();
  for (const wire of wires) {
    const fromKey = keyOf(wire.start.componentId, wire.start.pinName);
    const toKey = keyOf(wire.end.componentId, wire.end.pinName);
    uf.union(fromKey, toKey);
    if (!wire.bb) {
      visibleEndpoints.add(fromKey);
      visibleEndpoints.add(toKey);
    }
    for (const endpoint of [wire.start, wire.end]) {
      const owner = byId.get(endpoint.componentId);
      if (!owner || !isBreadboardMetadata(owner.metadataId)) continue;
      const group = breadboardGroupKey(owner.metadataId, endpoint.pinName);
      if (group) uf.union(keyOf(endpoint.componentId, endpoint.pinName), 'bb::' + endpoint.componentId + '::' + group);
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const wire of wires) {
    for (const endpoint of [wire.start, wire.end]) {
      const key = keyOf(endpoint.componentId, endpoint.pinName);
      const root = uf.find(key);
      const bucket = groups.get(root) ?? new Set<string>();
      bucket.add(key);
      groups.set(root, bucket);
    }
  }

  const nets: CircuitJsonNet[] = [];
  for (const bucket of groups.values()) {
    const pins: string[] = [];
    let touchesVisible = false;
    for (const key of bucket) {
      const [componentId, pinName] = key.split('::');
      const owner = byId.get(componentId);
      if (!owner) continue;
      const label = owner.ref + '.' + (isBreadboardMetadata(owner.metadataId) ? breadboardPinName(pinName) : pinName);
      pins.push(label);
      if (visibleEndpoints.has(key)) touchesVisible = true;
    }
    if (!touchesVisible || pins.length < 2) continue;
    nets.push({ 引脚: pins.slice(0, 40) });
    if (nets.length >= 60) break;
  }
  return nets;
}

/** 元件元素上的引脚坐标（元素本地坐标系）。 */
interface ElementPin {
  name: string;
  x: number;
  y: number;
}

/** 读某个元件当前挂载后的引脚表；未挂载返回 null。 */
function elementPins(componentId: string): ElementPin[] | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById(componentId) as (Element & { pinInfo?: ElementPin[] }) | null;
  try {
    const info = element?.pinInfo;
    return Array.isArray(info) && info.length > 0 ? info : null;
  } catch {
    return null;
  }
}

/** 一帧等待；浏览器里用 rAF，Node 测试里退化成定时器。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

/** 等 React 挂载完一遍再读 DOM 引脚。 */
async function layoutSettled(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/** 校验通过后的落地计划。 */
interface PlannedComponent {
  ref: string;
  metadataId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  /** 是否声明为"插在面包板上"（提交后补一次吸附）。 */
  seated?: boolean;
  /** 吸附锚点：面包板编号 + 第一个引脚要插的孔（用于精确对齐）。 */
  seatAnchor?: { anchorRef: string; hole: string };
}

interface PlannedBoard {
  ref: string;
  kind: BoardKind;
  x: number;
  y: number;
  rotation: number;
}

interface PlannedWire {
  fromRef: string;
  fromPin: string;
  toRef: string;
  toPin: string;
  color?: string;
}

interface Plan {
  boards: PlannedBoard[];
  components: PlannedComponent[];
  wires: PlannedWire[];
}

/** 把 "编号.引脚" 拆成两段（只按第一个点切）。 */
function splitEndpoint(endpoint: string): { ref: string; pin: string } | null {
  const dot = endpoint.indexOf('.');
  if (dot <= 0 || dot >= endpoint.length - 1) return null;
  return { ref: endpoint.slice(0, dot), pin: endpoint.slice(dot + 1) };
}

/**
 * 校验并生成落地计划（不接触画布）。
 * @param input - 电路 JSON 文本或对象。
 * @returns 计划或错误列表。
 */
function planCircuitJson(input: unknown): { plan?: Plan; issues: string[] } {
  const issues: string[] = [];
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      return { issues: ['JSON 解析失败：' + String(error)] };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { issues: ['顶层必须是 JSON 对象'] };
  }
  const record = raw as Record<string, unknown>;
  if (record.版本 !== CIRCUIT_JSON_VERSION) {
    issues.push('版本必须是 ' + CIRCUIT_JSON_VERSION);
  }
  const parts = record.元件;
  const wireRows = record.连线;
  if (!Array.isArray(parts)) issues.push('缺少 元件 数组');
  if (!Array.isArray(wireRows)) issues.push('缺少 连线 数组');
  if (issues.length > 0) return { issues };

  const registry = ComponentRegistry.getInstance();
  const refs = new Map<string, { metadataId: string; isBoard: boolean }>();
  const plannedBoards: PlannedBoard[] = [];
  const plannedComponents: PlannedComponent[] = [];
  /** 已确定坐标的元件（面包板可以晚于插在上面的元件声明）。 */
  const placed = new Map<string, { x: number; y: number }>();
  const pendingSeated: Array<{
    ref: string;
    type: string;
    properties: Record<string, unknown>;
    anchorRef: string;
    hole: { x: number; y: number };
    holeName: string;
  }> = [];

  for (const [index, item] of (parts as unknown[]).entries()) {
    const label = '元件[' + index + ']';
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(label + ' 不是对象');
      continue;
    }
    const part = item as Record<string, unknown>;
    const ref = typeof part.编号 === 'string' ? part.编号.trim() : '';
    const type = typeof part.型号 === 'string' ? part.型号.trim() : '';
    if (!/^[A-Za-z][A-Za-z0-9_]{0,7}$/.test(ref)) {
      issues.push(label + ' 的 编号 不合法（1 个字母开头 + 最多 7 位字母数字）');
      continue;
    }
    if (refs.has(ref)) {
      issues.push('编号 ' + ref + ' 重复');
      continue;
    }
    const isBoard = isKnownBoardKind(type);
    const meta = isBoard ? undefined : registry.getById(type);
    if (!isBoard && !meta) {
      issues.push(label + ' 的 型号 未知：' + type);
      continue;
    }
    refs.set(ref, { metadataId: type, isBoard });

    const seat = part.插在;
    const at = part.位置;
    if (seat !== undefined && at !== undefined) {
      issues.push('编号 ' + ref + ' 不能同时有 位置 和 插在');
      continue;
    }
    const rotation = typeof part.旋转 === 'number' ? part.旋转 : 0;

    if (isBoard) {
      if (!Array.isArray(at) || at.length !== 2 || typeof at[0] !== 'number' || typeof at[1] !== 'number') {
        issues.push('板卡 ' + ref + ' 必须有 位置 [x, y]');
        continue;
      }
      plannedBoards.push({ ref, kind: type as BoardKind, x: at[0], y: at[1], rotation });
      placed.set(ref, { x: at[0], y: at[1] });
      continue;
    }

    // 元件的可选参数（与位置无关，先算好）。
    const properties: Record<string, unknown> = { ...(meta?.defaultValues ?? {}) };
    const params = part.参数;
    const declared = new Set<string>((meta?.properties ?? []).map((property) => property.name));
    declared.add('color');
    if (params !== undefined) {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        issues.push('编号 ' + ref + ' 的 参数 必须是对象');
        continue;
      }
      let paramOk = true;
      for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
        if (!declared.has(key)) {
          issues.push('编号 ' + ref + ' 的参数 ' + key + ' 不在型号 ' + type + ' 的参数表里');
          paramOk = false;
          continue;
        }
        properties[key] = value;
      }
      if (!paramOk) continue;
    }
    if (rotation !== 0) properties.rotation = rotation;
    properties.ref = ref;

    if (Array.isArray(at) && at.length === 2 && typeof at[0] === 'number' && typeof at[1] === 'number') {
      plannedComponents.push({ ref, metadataId: type, x: at[0], y: at[1], properties });
      placed.set(ref, { x: at[0], y: at[1] });
      continue;
    }
    if (seat && typeof seat === 'object' && !Array.isArray(seat)) {
      const seatMap = seat as Record<string, unknown>;
      const firstHole = Object.values(seatMap).find((value): value is string => typeof value === 'string');
      if (!firstHole) {
        issues.push('编号 ' + ref + ' 的 插在 里没有合法的孔位');
        continue;
      }
      const holeRef = splitEndpoint(firstHole);
      if (!holeRef) {
        issues.push('编号 ' + ref + ' 的 插在 孔位格式应为 "面包板编号.孔位"');
        continue;
      }
      const boardOwner = refs.get(holeRef.ref);
      if (!boardOwner || !isBreadboardMetadata(boardOwner.metadataId)) {
        issues.push('编号 ' + ref + ' 插在 ' + holeRef.ref + ' 上，但那不是面包板');
        continue;
      }
      const holes = boardOwner.metadataId === 'breadboard-mini' ? BREADBOARD_MINI_PINS : BREADBOARD_PINS;
      const internal = breadboardHoleName(holeRef.pin) ?? holeRef.pin;
      const hole = holes.find((candidate) => candidate.name === internal);
      if (!hole) {
        issues.push('编号 ' + ref + ' 插在的孔不存在：' + firstHole);
        continue;
      }
      pendingSeated.push({
        ref,
        type,
        properties,
        anchorRef: holeRef.ref,
        hole: { x: hole.x, y: hole.y },
        holeName: holeRef.pin,
      });
      continue;
    }
    issues.push('编号 ' + ref + ' 必须有 位置 或 插在');
  }

  // 第二遍：把"插在面包板上"的元件按孔位算出坐标（允许面包板晚声明）。
  for (const pending of pendingSeated) {
    const anchor = placed.get(pending.anchorRef);
    if (!anchor) {
      issues.push('编号 ' + pending.ref + ' 插在的面包板 ' + pending.anchorRef + ' 必须有 位置');
      continue;
    }
    const x = anchor.x + pending.hole.x - 28;
    const y = anchor.y + pending.hole.y - 10;
    plannedComponents.push({
      ref: pending.ref,
      metadataId: pending.type,
      x,
      y,
      properties: pending.properties,
      seated: true,
      seatAnchor: { anchorRef: pending.anchorRef, hole: pending.holeName },
    });
    placed.set(pending.ref, { x, y });
  }

  const plannedWires: PlannedWire[] = [];
  const seen = new Set<string>();
  for (const [index, item] of (wireRows as unknown[]).entries()) {
    const label = '连线[' + index + ']';
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(label + ' 不是对象');
      continue;
    }
    const row = item as Record<string, unknown>;
    const from = typeof row.起点 === 'string' ? splitEndpoint(row.起点) : null;
    const to = typeof row.终点 === 'string' ? splitEndpoint(row.终点) : null;
    if (!from || !to) {
      issues.push(label + ' 的 起点 / 终点 必须是 "编号.引脚"');
      continue;
    }
    if (!refs.has(from.ref) || !refs.has(to.ref)) {
      issues.push(label + ' 引用了不存在的编号：' + (refs.has(from.ref) ? to.ref : from.ref));
      continue;
    }
    if (from.ref === to.ref && from.pin === to.pin) {
      issues.push(label + ' 两端是同一个引脚');
      continue;
    }
    const signature = [from.ref + '.' + from.pin, to.ref + '.' + to.pin].sort().join('|');
    if (seen.has(signature)) {
      issues.push(label + ' 与前面的连线重复：' + signature);
      continue;
    }
    seen.add(signature);
    plannedWires.push({
      fromRef: from.ref,
      fromPin: from.pin,
      toRef: to.ref,
      toPin: to.pin,
      color: typeof row.颜色 === 'string' ? row.颜色 : undefined,
    });
  }

  if (issues.length > 0) return { issues };
  return {
    plan: { boards: plannedBoards, components: plannedComponents, wires: plannedWires },
    issues: [],
  };
}

/** 生成一条面包板座线的内部引脚名（把用户孔名转成 pinInfo 名）。 */
function canonicalPin(metadataId: string, pin: string): string {
  if (!isBreadboardMetadata(metadataId)) return pin;
  return breadboardHoleName(pin) ?? pin;
}

/** 把落地计划写进画布（调用前 planCircuitJson 已经校验过结构）。 */
async function commitPlan(plan: Plan): Promise<{ ok: boolean; issues: string[] }> {
  const store = useSimulatorStore.getState();
  const editor = useEditorStore.getState();
  const metadataById = new Map<string, string>();
  const boardIds = new Map<string, string>();
  const usedBoardIds = new Set<string>();

  const boards: BoardInstance[] = plan.boards.map((board) => {
    let id = board.kind;
    for (let index = 2; usedBoardIds.has(id); index += 1) id = board.kind + '-' + index;
    usedBoardIds.add(id);
    boardIds.set(board.ref, id);
    metadataById.set(id, board.kind);
    return {
      id,
      ref: board.ref,
      boardKind: board.kind,
      x: board.x,
      y: board.y,
      rotation: board.rotation,
      running: false,
      compiledProgram: null,
      serialOutput: '',
      serialBaudRate: 115200,
      serialMonitorOpen: false,
      activeFileGroupId: id,
      languageMode: 'arduino',
    };
  });

  const componentIds = new Map<string, string>();
  const components: Component[] = plan.components.map((component) => {
    const id = generateUUID();
    componentIds.set(component.ref, id);
    metadataById.set(id, component.metadataId);
    return {
      id,
      metadataId: component.metadataId,
      x: component.x,
      y: component.y,
      properties: component.properties,
    };
  });

  const resolveId = (ref: string): string | undefined => boardIds.get(ref) ?? componentIds.get(ref);

  const wires: Wire[] = [];
  for (const row of plan.wires) {
    const fromId = resolveId(row.fromRef);
    const toId = resolveId(row.toRef);
    if (!fromId || !toId) continue;
    const fromMeta = metadataById.get(fromId) ?? '';
    const toMeta = metadataById.get(toId) ?? '';
    const fromPin = canonicalPin(fromMeta, row.fromPin);
    const toPin = canonicalPin(toMeta, row.toPin);
    wires.push({
      id: generateUUID(),
      start: { componentId: fromId, pinName: fromPin, x: 0, y: 0 },
      end: { componentId: toId, pinName: toPin, x: 0, y: 0 },
      waypoints: [],
      color: row.color ?? autoWireColor(fromPin),
      autoRouted: false,
    });
  }

  store.loadProjectState({
    boards,
    components,
    wires,
    fileGroups: editor.fileGroups,
    folderGroups: editor.folderGroups,
    activeBoardId: boards[0]?.id ?? null,
  });

  await layoutSettled();

  // 插在面包板上的元件：等元素挂载后，按第一个引脚把元件精确对齐到孔位，再吸附。
  const anchored = plan.components.filter((component) => component.seatAnchor !== undefined);
  for (let round = 0; round < 6 && anchored.length > 0; round += 1) {
    let waiting = 0;
    const liveStore = useSimulatorStore.getState();
    for (const component of anchored) {
      const anchor = component.seatAnchor;
      const id = componentIds.get(component.ref);
      const boardId = anchor ? componentIds.get(anchor.anchorRef) ?? boardIds.get(anchor.anchorRef) : undefined;
      if (!anchor || !id || !boardId) continue;
      const breadboard = liveStore.components.find((item) => item.id === boardId);
      const pins = elementPins(id);
      if (!breadboard || !pins || pins.length === 0) {
        waiting += 1;
        continue;
      }
      const holes = breadboard.metadataId === 'breadboard-mini' ? BREADBOARD_MINI_PINS : BREADBOARD_PINS;
      const internal = breadboardHoleName(anchor.hole) ?? anchor.hole;
      const hole = holes.find((candidate) => candidate.name === internal);
      if (!hole) continue;
      const first = pins[0];
      useSimulatorStore.getState().updateComponent(id, {
        x: breadboard.x + hole.x - first.x,
        y: breadboard.y + hole.y - first.y,
      });
      liveStore.reseatComponentOnBreadboard(id);
    }
    if (waiting === 0) break;
    await nextFrame();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // 画布已经重建：逐根确认引脚真实存在，失败就回滚。
  const issues: string[] = [];
  const live = useSimulatorStore.getState();
  const ownerMeta = (componentId: string): string => {
    const board = live.boards.find((item) => item.id === componentId);
    if (board) return board.boardKind;
    const component = live.components.find((item) => item.id === componentId);
    return component?.metadataId ?? '';
  };
  for (const wire of live.wires) {
    if (wire.bb) continue;
    const fromMeta = ownerMeta(wire.start.componentId);
    const toMeta = ownerMeta(wire.end.componentId);
    if (!resolvePinName(wire.start.componentId, fromMeta, wire.start.pinName)) {
      issues.push('连线起点引脚不存在：' + fromMeta + ' / ' + wire.start.pinName);
    }
    if (!resolvePinName(wire.end.componentId, toMeta, wire.end.pinName)) {
      issues.push('连线终点引脚不存在：' + toMeta + ' / ' + wire.end.pinName);
    }
  }
  live.recalculateAllWirePositions();
  return { ok: issues.length === 0, issues };
}

/**
 * 把电路 JSON 应用到画布。结构校验失败时画布保持原样；
 * 写入后如果发现引脚不存在，会尝试回滚到导入前的画布。
 * @param input - 电路 JSON（对象或文本）。
 * @returns 是否成功，以及问题列表。
 */
export async function applyCircuitJson(input: unknown): Promise<{ ok: boolean; issues: string[] }> {
  const { plan, issues } = planCircuitJson(input);
  if (!plan) return { ok: false, issues };
  const previous = buildCircuitJson();
  const result = await commitPlan(plan);
  if (result.ok) return result;
  // 回滚：把导入前的画布再重建一次（尽力而为）。
  const rollback = planCircuitJson(previous);
  if (rollback.plan) {
    await commitPlan(rollback.plan);
    return { ok: false, issues: [...result.issues, '画布已回滚到导入前状态'] };
  }
  return result;
}
