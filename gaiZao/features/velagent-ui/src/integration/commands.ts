/**
 * AI 命令执行器（M1）：Rust 通过 Tauri event 把命令下发到这里，
 * 这里调用 zustand store 操作画布，再把最新状态回传给 Rust。
 *
 * 支持：place_board / update_board / remove_board / place_component /
 *      update_component / remove_component / connect / remove_wire /
 *      batch / validate / highlight / view / clear / undo / redo /
 *      code_get / code_set / timeline_play / timeline_stop / export_project
 */
import { useSimulatorStore } from '../store/useSimulatorStore';
import { ComponentRegistry } from '../lib/ComponentRegistry';
import { generateUUID } from '../utils/uuid';
import { BREADBOARD_PINS } from '../velxio-elements/breadboard-element';
import { BREADBOARD_MINI_PINS } from '../velxio-elements/breadboard-mini-element';
import { BOARD_KIND_LABELS, isKnownBoardKind, type BoardKind } from '../types/board';
import { autoWireColor } from '../utils/wireUtils';
import { bumpWorkspaceRevision, serializeWorkspace } from './workspaceState';
import { validateCircuit, type ValidationIssue } from './validate';
import { getCode, setCode } from './editorCode';
import { playTimeline, stopTimeline, type TimelineEvent } from './playback';
import { exportProject } from './projectExport';
import {
  breadboardHoleName,
  isBreadboardMetadata,
  resolvePinName,
  visiblePinNames,
} from '../utils/pinNames';
import {
  applyCircuitJson,
  assignBoardRef,
  assignComponentRef,
  buildCircuitJson,
  ensureRefs,
} from './circuitJson';
import {
  collectComponentRects,
  collectWireSegments,
  routeAroundObstacles,
} from '../utils/wireAutoRoute';

export interface CommandOutcome {
  workspace: ReturnType<typeof serializeWorkspace>;
  result?: unknown;
}

type Json = Record<string, unknown>;

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 面包板孔名（a3 / f12 / 3t.a / tp.1）→ 内部 pinInfo 名称（实现见 utils/pinNames）。 */
export { breadboardHoleName };

function holePosition(hole: string): { x: number; y: number } | null {
  const name = breadboardHoleName(hole);
  if (!name) return null;
  const pin = BREADBOARD_PINS.find((p) => p.name === name);
  if (!pin) return null;
  return { x: pin.x, y: pin.y };
}

function finish(): CommandOutcome {
  const store = useSimulatorStore.getState();
  try {
    store.recalculateAllWirePositions();
  } catch {
    /* 画布还没挂载时忽略 */
  }
  // 每个成功的画布命令都推进 revision，供 Agent 在超时后用 velagent_get_revision 复核。
  bumpWorkspaceRevision();
  return { workspace: serializeWorkspace() };
}

function autoPosition(metaId: string): { x: number; y: number } {
  const s = useSimulatorStore.getState();
  const boards = s.boards.length;
  const comps = s.components.length;
  const breadboard = s.components.find((c) => c.metadataId === 'breadboard');
  if (breadboard && metaId !== 'breadboard') {
    return { x: breadboard.x + 60 + (comps % 6) * 40, y: breadboard.y + 40 + Math.floor(comps / 6) * 40 };
  }
  return { x: 80 + (boards > 1 ? (boards - 1) * 460 : 0) + (comps % 5) * 60, y: 160 + Math.floor(comps / 5) * 60 };
}

/** 找一个板卡/元件：接受画布 id 或变量名（ref）。 */

/** 一个用于布局 / 折线的二维点。 */
interface Point2 { x: number; y: number }

/** 解析 "B1.a3" 这种孔位引用。 */
function splitHoleRef(value: string): { ref: string; hole: string } | null {
  const dot = value.indexOf('.');
  if (dot <= 0 || dot >= value.length - 1) return null;
  return { ref: value.slice(0, dot), hole: value.slice(dot + 1) };
}

/** 从渲染后的元件 / 板卡元素量取包围盒（拿不到时返回 null）。 */
function elementBox(id: string): { x: number; y: number; w: number; h: number } | null {
  if (typeof document === 'undefined') return null;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const element = (document.querySelector('.dynamic-component-wrapper[data-component-id="' + escaped + '"]')
    ?? document.getElementById(id)) as HTMLElement | null;
  if (!element) return null;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (!width || !height) return null;
  return { x: 0, y: 0, w: width, h: height };
}

/** 两条轴对齐线段是否相交（不含共享端点）。 */
function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const same = (p: Point2, q: Point2): boolean => p.x === q.x && p.y === q.y;
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const cross = (p: Point2, q: Point2, r: Point2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 一根线的绘制折线（端点 + 折点 + 端点）。 */
function wirePoints(wire: { start: Point2; end: Point2; waypoints?: Point2[] }): Point2[] {
  return [
    { x: wire.start.x, y: wire.start.y },
    ...(wire.waypoints ?? []).map((point) => ({ x: point.x, y: point.y })),
    { x: wire.end.x, y: wire.end.y },
  ];
}

/** 布局报告：元件包围盒 + 导线折线 / 包围盒 + 交叉对 + 内容边界。 */
function layoutReport(): Json {
  const store = useSimulatorStore.getState();
  try { store.recalculateAllWirePositions(); } catch { /* 画布未挂载时忽略 */ }
  const live = useSimulatorStore.getState();
  const refs = ensureRefs();
  const parts: Json[] = [];
  for (const board of live.boards) {
    const size = elementBox(board.id);
    parts.push({
      id: board.id,
      ref: refs.board.get(board.id) ?? null,
      kind: 'board',
      model: board.boardKind,
      x: board.x,
      y: board.y,
      rotation: board.rotation ?? 0,
      bbox: { x: board.x, y: board.y, w: size?.w ?? null, h: size?.h ?? null },
    });
  }
  for (const component of live.components) {
    const rotation = Number((component.properties as Record<string, unknown> | undefined)?.rotation) || 0;
    const size = elementBox(component.id);
    parts.push({
      id: component.id,
      ref: refs.component.get(component.id) ?? null,
      kind: 'component',
      model: component.metadataId,
      x: component.x,
      y: component.y,
      rotation,
      bbox: { x: component.x, y: component.y, w: size?.w ?? null, h: size?.h ?? null },
    });
  }
  const wires: Json[] = [];
  const crossPairs: string[][] = [];
  const wireSegments: Array<{ id: string; segs: Array<[Point2, Point2]> }> = [];
  for (const wire of live.wires) {
    if (wire.bb) continue;
    const points = wirePoints(wire);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const row = {
      id: wire.id,
      from: { owner_id: wire.start.componentId, pin: wire.start.pinName },
      to: { owner_id: wire.end.componentId, pin: wire.end.pinName },
      color: wire.color,
      points: points.map((point) => [point.x, point.y]),
      bbox: {
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
      },
    };
    wires.push(row);
    const segs: Array<[Point2, Point2]> = [];
    for (let index = 1; index < points.length; index += 1) segs.push([points[index - 1], points[index]]);
    wireSegments.push({ id: wire.id, segs });
  }
  outer: for (let left = 0; left < wireSegments.length; left += 1) {
    for (let right = left + 1; right < wireSegments.length; right += 1) {
      const a = wireSegments[left];
      const b = wireSegments[right];
      const crossing = a.segs.some(([a0, a1]) => b.segs.some(([b0, b1]) => segmentsCross(a0, a1, b0, b1)));
      if (crossing) {
        crossPairs.push([a.id, b.id]);
        if (crossPairs.length >= 200) break outer;
      }
    }
  }
  const boxes = parts
    .map((part) => part.bbox as { x: number; y: number; w: number | null; h: number | null })
    .filter((box) => box.w !== null && box.h !== null) as Array<{ x: number; y: number; w: number; h: number }>;
  const minX = Math.min(...boxes.map((box) => box.x), 0);
  const minY = Math.min(...boxes.map((box) => box.y), 0);
  const maxX = Math.max(...boxes.map((box) => box.x + box.w), 0);
  const maxY = Math.max(...boxes.map((box) => box.y + box.h), 0);
  return {
    layout: {
      parts,
      wires,
      crossings: crossPairs,
      contentBounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      viewport: typeof window === 'undefined'
        ? null
        : { width: window.innerWidth, height: window.innerHeight },
      counts: { parts: parts.length, wires: wires.length, crossings: crossPairs.length },
    },
  };
}

/** 设置一根导线的折点。 */
function setWirePath(id: string, rawPoints: unknown): Json {
  if (!Array.isArray(rawPoints)) throw new Error('路径必须是 [x, y] 数组');
  if (rawPoints.length > 128) throw new Error('折点最多 128 个');
  const points: Point2[] = [];
  for (const [index, raw] of rawPoints.entries()) {
    if (!Array.isArray(raw) || raw.length !== 2 || !Number.isFinite(raw[0]) || !Number.isFinite(raw[1])) {
      throw new Error('路径[' + String(index) + '] 必须是 [x, y] 数字');
    }
    points.push({ x: raw[0] as number, y: raw[1] as number });
  }
  const store = useSimulatorStore.getState();
  const wire = store.wires.find((item) => item.id === id);
  if (!wire) throw new Error('找不到导线: ' + id);
  store.recordUpdateWire(id, { waypoints: wire.waypoints }, { waypoints: points, autoRouted: false }, 'agent set wire path');
  return { wire_id: id, waypoints: points.map((point) => [point.x, point.y]) };
}

/** L 形折点：按位移方向选一个拐角。 */
function elbowPoints(start: Point2, end: Point2): Point2[] {
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
    ? [{ x: end.x, y: start.y }]
    : [{ x: start.x, y: end.y }];
}

/** 线束 / 总线：同方向的多根线在中线附近按 spacing 等距铺开。 */
function busPoints(start: Point2, end: Point2, index: number, count: number, spacing: number): Point2[] {
  const lane = (index - (count - 1) / 2) * spacing;
  if (Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)) {
    const midY = (start.y + end.y) / 2 + lane;
    return [{ x: start.x, y: midY }, { x: end.x, y: midY }];
  }
  const midX = (start.x + end.x) / 2 + lane;
  return [{ x: midX, y: start.y }, { x: midX, y: end.y }];
}

/** 批量自动布线。 */
function autoRouteWires(cmd: Json): Json {
  const mode = String(cmd.mode ?? 'orthogonal+avoid');
  if (!['straight', 'orthogonal', 'orthogonal+avoid'].includes(mode)) {
    throw new Error('mode 必须是 straight / orthogonal / orthogonal+avoid');
  }
  const spacing = typeof cmd.spacing === 'number' && Number.isFinite(cmd.spacing) && cmd.spacing > 0
    ? cmd.spacing
    : 0;
  const scope = cmd.scope;
  const store = useSimulatorStore.getState();
  try { store.recalculateAllWirePositions(); } catch { /* 未挂载 */ }
  const current = useSimulatorStore.getState();
  const wires = current.wires.filter((wire) => !wire.bb);
  let targets = wires;
  if (Array.isArray(scope)) {
    const ids = new Set(scope.filter((value): value is string => typeof value === 'string'));
    targets = wires.filter((wire) => ids.has(wire.id));
  } else if (typeof scope === 'string' && scope !== 'all') {
    const wire = wires.find((item) => item.id === scope);
    if (!wire) throw new Error('找不到导线: ' + scope);
    targets = [wire];
  }
  const components = current.components.map((component) => ({ id: component.id, x: component.x, y: component.y }));
  const rects = collectComponentRects(components);
  const updated: Json[] = [];
  targets.forEach((target, index) => {
    const live = useSimulatorStore.getState();
    const wire = live.wires.find((item) => item.id === target.id);
    if (!wire) return;
    const start = { x: wire.start.x, y: wire.start.y };
    const end = { x: wire.end.x, y: wire.end.y };
    let points: Point2[] | null;
    if (mode === 'straight') {
      points = [];
    } else if (mode === 'orthogonal') {
      points = elbowPoints(start, end);
    } else {
      const obstacles = rects
        .filter((rect) => rect.id !== wire.start.componentId && rect.id !== wire.end.componentId)
        .map((rect) => rect.rect);
      const segments = collectWireSegments(live.wires, wire.id);
      points = routeAroundObstacles(start, end, obstacles, segments) ?? elbowPoints(start, end);
    }
    if (spacing > 0 && targets.length > 1) points = busPoints(start, end, index, targets.length, spacing);
    useSimulatorStore.getState().recordUpdateWire(wire.id, { waypoints: wire.waypoints }, {
      waypoints: points ?? [],
      autoRouted: false,
    }, 'agent autoroute');
    updated.push({
      wire_id: wire.id,
      waypoints: (points ?? []).map((point) => [point.x, point.y]),
    });
  });
  return { mode, spacing, updated, count: updated.length };
}

/** 显式把元件插到面包板孔位（holes: 引脚名 → "B1.a3"）。 */
async function seatComponent(cmd: Json): Promise<Json> {
  const id = resolveOwnerId(cmd.ref ?? cmd.id);
  const holes = cmd.holes;
  const store = useSimulatorStore.getState();
  const component = store.components.find((item) => item.id === id);
  if (!component) throw new Error('只能用 velagent_seat 给元件插板，当前目标不是元件');
  if (holes !== undefined) {
    if (!holes || typeof holes !== 'object' || Array.isArray(holes)) throw new Error('holes 必须是 引脚名 → "面包板编号.孔位" 的对象');
    const first = Object.entries(holes as Record<string, unknown>)
      .find((entry): entry is [string, string] => typeof entry[1] === 'string');
    if (first) {
      const [pinName, holeValue] = first;
      const holeRef = splitHoleRef(holeValue);
      if (!holeRef) throw new Error('孔位格式应为 "面包板编号.孔位"');
      const board = store.components.find((item) =>
        isBreadboardMetadata(item.metadataId)
        && ((item.properties?.ref as string | undefined) === holeRef.ref || item.id === holeRef.ref));
      if (!board) throw new Error('找不到面包板: ' + holeRef.ref);
      const pins = elementPinsOf(id);
      const pin = pins?.find((candidate) => candidate.name === pinName);
      if (!pin) throw new Error('元件 ' + String(component.properties?.ref ?? id) + ' 没有引脚 ' + pinName);
      const holesList = board.metadataId === 'breadboard-mini' ? BREADBOARD_MINI_PINS : BREADBOARD_PINS;
      const internal = breadboardHoleName(holeRef.hole) ?? holeRef.hole;
      const hole = holesList.find((candidate) => candidate.name === internal);
      if (!hole) throw new Error('面包板孔不存在: ' + holeValue);
      useSimulatorStore.getState().updateComponent(id, {
        x: board.x + hole.x - pin.x,
        y: board.y + hole.y - pin.y,
      });
      await settleFrames();
    }
  }
  useSimulatorStore.getState().reseatComponentOnBreadboard(id);
  const ref = ensureRefs().component.get(id) ?? null;
  return { ok: true, id, ref, holes: holes ?? null };
}

/** 读一个元件元素的 pinInfo（挂载后才有）。 */
function elementPinsOf(id: string): Array<{ name: string; x: number; y: number }> | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById(id) as (Element & { pinInfo?: Array<{ name: string; x: number; y: number }> }) | null;
  const info = element?.pinInfo;
  return Array.isArray(info) && info.length > 0 ? info : null;
}

function resolveOwnerId(value: unknown): string {
  const wanted = String(value ?? '').trim();
  if (!wanted) throw new Error('缺少板卡/元件 id 或编号');
  const snapshot = useSimulatorStore.getState();
  if (snapshot.boards.some((board) => board.id === wanted)) return wanted;
  if (snapshot.components.some((component) => component.id === wanted)) return wanted;
  const board = snapshot.boards.find((item) => item.ref === wanted);
  if (board) return board.id;
  const component = snapshot.components.find((item) => item.properties?.ref === wanted);
  if (component) return component.id;
  throw new Error('找不到板卡/元件: ' + wanted);
}

/** 某个归属物的型号（板卡给 boardKind，元件给 metadataId）。 */
function metadataOf(ownerId: string): string | null {
  const snapshot = useSimulatorStore.getState();
  const board = snapshot.boards.find((item) => item.id === ownerId);
  if (board) return board.boardKind;
  const component = snapshot.components.find((item) => item.id === ownerId);
  return component?.metadataId ?? null;
}

/** 引脚摘要：面包板给孔位说明，其他元件给真实引脚名。 */
function pinsForOwner(ownerId: string): Json | null {
  const metadataId = metadataOf(ownerId);
  if (!metadataId) return null;
  const names = visiblePinNames(ownerId, metadataId);
  if (!names) return null;
  if (isBreadboardMetadata(metadataId)) {
    return {
      count: names.length,
      naming: '孔位 = 行字母 + 列号（如 a5、f12）；电源轨写 tp.1 / tn.1 / bp.1 / bn.1',
      sample: names.slice(0, 12),
    };
  }
  return { count: names.length, names: names.slice(0, 80) };
}

/** 等 React 把新元件挂到 DOM 后再读引脚。 */
async function settleFrames(): Promise<void> {
  for (let index = 0; index < 2; index += 1) {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 16);
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
}

/** 解析一个连线端点：owner_id / ref 二者其一 + pin，pin 必须真实存在。 */
function resolveWireEndpoint(endpoint: Json, label: string): { ownerId: string; pinName: string; metadataId: string } {
  const pin = String(endpoint.pin ?? '').trim();
  const ownerValue = endpoint.owner_id ?? endpoint.ownerId ?? endpoint.ref;
  if (!pin) throw new Error('connect 的 ' + label + ' 缺少 pin');
  const ownerId = resolveOwnerId(ownerValue);
  const metadataId = metadataOf(ownerId);
  if (!metadataId) throw new Error('connect 的 ' + label + ' 指向不存在的板卡/元件');
  const canonical = resolvePinName(ownerId, metadataId, pin);
  if (!canonical) {
    const available = visiblePinNames(ownerId, metadataId) ?? [];
    const shown = available.slice(0, 40).join(', ') + (available.length > 40 ? ' …' : '');
    throw new Error(
      '引脚不存在: ' + label + ' ' + pin + '（可用引脚：' + (shown || '该元件还没挂载') + '）',
    );
  }
  return { ownerId, pinName: canonical, metadataId };
}

/** 元件元素上的引脚坐标（元素本地坐标系）。 */
interface ElementPin {
  name: string;
  x: number;
  y: number;
}

/**
 * 把 seat_on 指定的元件精确插到面包板孔上：等元素挂载后按第一个引脚对齐，再吸附。
 * @param componentId - 元件画布 id。
 * @param seatOn - 孔位（"a5" 或 "B1.a5"）。
 */
async function alignSeatOnBreadboard(componentId: string, seatOn: string): Promise<void> {
  const holeName = seatOn.split(':').pop() ?? seatOn;
  for (let round = 0; round < 6; round += 1) {
    const state = useSimulatorStore.getState();
    const breadboard =
      state.components.find((item) => item.metadataId === 'breadboard') ??
      state.components.find((item) => item.metadataId === 'breadboard-mini');
    if (!breadboard) return;
    const holes = breadboard.metadataId === 'breadboard-mini' ? BREADBOARD_MINI_PINS : BREADBOARD_PINS;
    const internal = breadboardHoleName(holeName) ?? holeName;
    const hole = holes.find((candidate) => candidate.name === internal);
    if (!hole) return;
    const element = document.getElementById(componentId) as (Element & { pinInfo?: ElementPin[] }) | null;
    const pins = element?.pinInfo;
    if (Array.isArray(pins) && pins.length > 0) {
      const first = pins[0];
      state.updateComponent(componentId, {
        x: breadboard.x + hole.x - first.x,
        y: breadboard.y + hole.y - first.y,
      });
      useSimulatorStore.getState().reseatComponentOnBreadboard(componentId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

/** 把命令里的 {t,leds,serial,note} 数组规范成播放器认识的 TimelineEvent[]。 */
function normalizeTimeline(value: unknown): TimelineEvent[] {
  if (!Array.isArray(value)) throw new Error('timeline_play 参数 timeline 必须是数组');
  return value.map((raw) => {
    const event = (raw && typeof raw === 'object' ? raw : {}) as Json;
    const leds: Record<string, boolean> = {};
    const rawLeds = event.leds;
    if (rawLeds && typeof rawLeds === 'object' && !Array.isArray(rawLeds)) {
      for (const [id, on] of Object.entries(rawLeds as Json)) leds[id] = Boolean(on);
    }
    return {
      t: num(event.t) ?? 0,
      ...(Object.keys(leds).length > 0 ? { leds } : {}),
      ...(typeof event.serial === 'string' ? { serial: event.serial } : {}),
      ...(typeof event.note === 'string' ? { note: event.note } : {}),
    };
  });
}

function applyOne(cmd: Json, recordUndo: boolean): unknown {
  const store = useSimulatorStore.getState();
  const op = String(cmd.op ?? '');
  switch (op) {
    case 'place_board': {
      const kind = String(cmd.kind ?? '');
      if (!isKnownBoardKind(kind)) throw new Error('未知板卡 kind: ' + kind + '（请先读取 /catalog/boards）');
      const pos = { x: num(cmd.x) ?? 40 + store.boards.length * 460, y: num(cmd.y) ?? 80 };
      const id = store.addBoard(kind as BoardKind, pos.x, pos.y);
      if (typeof cmd.name === 'string' && cmd.name) store.updateBoard(id, { name: cmd.name });
      if (typeof cmd.ref === 'string' && cmd.ref.trim()) store.updateBoard(id, { ref: cmd.ref.trim() });
      return { id, ref: assignBoardRef(id) };
    }
    case 'update_board': {
      const patch = (cmd.patch ?? {}) as Json;
      store.updateBoard(String(cmd.id), {
        ...(num(patch.x) !== undefined ? { x: num(patch.x)! } : {}),
        ...(num(patch.y) !== undefined ? { y: num(patch.y)! } : {}),
        ...(num(patch.rotation) !== undefined ? { rotation: num(patch.rotation)! } : {}),
        ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
      });
      return { ok: true };
    }
    case 'remove_board': {
      store.removeBoard(String(cmd.id));
      return { ok: true };
    }
    case 'place_component': {
      const metadataId = String(cmd.metadata_id ?? cmd.metadataId ?? '');
      const meta = ComponentRegistry.getInstance().getById(metadataId);
      if (!meta) throw new Error('未知元件 id: ' + metadataId + '（请先读取 /catalog/components）');
      const id = generateUUID();
      const seatOn = typeof cmd.seat_on === 'string' ? cmd.seat_on : undefined;
      let pos = { x: num(cmd.x) ?? NaN, y: num(cmd.y) ?? NaN };
      if (seatOn) {
        const bb = useSimulatorStore.getState().components.find((c) => c.metadataId === 'breadboard');
        const local = holePosition(seatOn.split(':').pop() ?? seatOn);
        if (bb && local) pos = { x: bb.x + local.x - 28, y: bb.y + local.y - 10 };
      }
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) pos = autoPosition(metadataId);
      const properties: Json = {
        ...(meta.defaultValues ?? {}),
        ...(num(cmd.rotation) !== undefined ? { rotation: num(cmd.rotation) } : {}),
        ...((cmd.properties as Json) ?? {}),
      };
      if (typeof cmd.ref === 'string' && cmd.ref.trim()) properties.ref = cmd.ref.trim();
      store.recordAddComponent({ id, metadataId, x: pos.x, y: pos.y, properties } as never);
      if (seatOn) {
        try {
          store.reseatComponentOnBreadboard(id);
        } catch {
          /* 吸附失败不致命 */
        }
      }
      return { id, ref: assignComponentRef(id) };
    }
    case 'update_component': {
      const id = resolveOwnerId(cmd.id ?? cmd.ref);
      const patch = (cmd.patch ?? {}) as Json;
      const board = useSimulatorStore.getState().boards.find((item) => item.id === id);
      if (board) {
        useSimulatorStore.getState().updateBoard(id, {
          ...(num(patch.x) !== undefined ? { x: num(patch.x)! } : {}),
          ...(num(patch.y) !== undefined ? { y: num(patch.y)! } : {}),
          ...(num(patch.rotation) !== undefined ? { rotation: num(patch.rotation)! } : {}),
          ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
        });
        const next = useSimulatorStore.getState().boards.find((item) => item.id === id);
        return { ok: true, id, kind: 'board', ref: next?.ref ?? board.ref ?? null, x: next?.x, y: next?.y, rotation: next?.rotation };
      }
      const update: Json = {};
      if (num(patch.x) !== undefined) update.x = num(patch.x);
      if (num(patch.y) !== undefined) update.y = num(patch.y);
      if (patch.properties && typeof patch.properties === 'object') {
        const current = useSimulatorStore.getState().components.find((c) => c.id === id);
        update.properties = { ...(current?.properties ?? {}), ...(patch.properties as Json) };
      }
      if (num(patch.rotation) !== undefined) {
        const current = useSimulatorStore.getState().components.find((c) => c.id === id);
        update.properties = { ...(current?.properties ?? {}), ...(update.properties as Json), rotation: num(patch.rotation) };
      }
      store.updateComponent(id, update as never);
      return { ok: true };
    }
    case 'remove_component': {
      const id = resolveOwnerId(cmd.id ?? cmd.ref);
      if (recordUndo) store.recordRemoveComponent(id);
      else store.removeComponent(id);
      return { ok: true };
    }
    case 'connect': {
      const from = (cmd.from ?? {}) as Json;
      const to = (cmd.to ?? {}) as Json;
      const fromEndpoint = resolveWireEndpoint(from, '起点');
      const toEndpoint = resolveWireEndpoint(to, '终点');
      if (
        fromEndpoint.ownerId === toEndpoint.ownerId &&
        fromEndpoint.pinName === toEndpoint.pinName
      ) {
        throw new Error('connect 的两端是同一个引脚');
      }
      const duplicate = useSimulatorStore.getState().wires.some((wire) => {
        const same =
          wire.start.componentId === fromEndpoint.ownerId &&
          wire.start.pinName === fromEndpoint.pinName &&
          wire.end.componentId === toEndpoint.ownerId &&
          wire.end.pinName === toEndpoint.pinName;
        const reversed =
          wire.start.componentId === toEndpoint.ownerId &&
          wire.start.pinName === toEndpoint.pinName &&
          wire.end.componentId === fromEndpoint.ownerId &&
          wire.end.pinName === fromEndpoint.pinName;
        return same || reversed;
      });
      if (duplicate) throw new Error('这两个引脚之间已经有一根线了');
      const waypoints: Array<{ x: number; y: number }> = [];
      if (Array.isArray(cmd.path)) {
        for (const raw of cmd.path) {
          if (Array.isArray(raw) && raw.length === 2 && Number.isFinite(raw[0]) && Number.isFinite(raw[1])) {
            waypoints.push({ x: raw[0] as number, y: raw[1] as number });
          }
        }
      }
      const wire = {
        id: generateUUID(),
        start: { componentId: fromEndpoint.ownerId, pinName: fromEndpoint.pinName, x: 0, y: 0 },
        end: { componentId: toEndpoint.ownerId, pinName: toEndpoint.pinName, x: 0, y: 0 },
        waypoints,
        color: typeof cmd.color === 'string' ? cmd.color : autoWireColor(fromEndpoint.pinName),
        ...(typeof cmd.signal === 'string' ? { signalType: cmd.signal } : {}),
      };
      store.recordAddWire(wire as never);
      return { id: wire.id, from: fromEndpoint.pinName, to: toEndpoint.pinName };
    }
    case 'remove_wire': {
      if (recordUndo) store.recordRemoveWire(String(cmd.id));
      else store.removeWire(String(cmd.id));
      return { ok: true };
    }
    case 'undo': {
      const steps = Math.max(1, Math.min(50, Math.floor(num(cmd.steps) ?? 1)));
      for (let index = 0; index < steps; index += 1) store.undo();
      return { ok: true, steps };
    }
    case 'redo': {
      store.redo();
      return { ok: true };
    }
    case 'highlight': {
      const owner = cmd.owner_id ?? cmd.ref;
      const ownerId = owner === undefined ? undefined : resolveOwnerId(owner);
      const detail = { ...cmd, ...(ownerId ? { owner_id: ownerId } : {}) };
      window.dispatchEvent(new CustomEvent('velagent:highlight', { detail }));
      return { ok: true, message: cmd.message ?? '', owner_id: ownerId ?? null, pins: cmd.pins ?? [] };
    }
    case 'view': {
      window.dispatchEvent(new CustomEvent('velagent:view', { detail: cmd.target ?? cmd }));
      return { ok: true };
    }
    case 'clear': {
      // 清空整个画布（板卡 + 元件 + 连线）。loadProjectState 会停止仿真、
      // 重建空工作区，并同步清空编辑器文件组。
      store.loadProjectState({
        boards: [],
        fileGroups: {},
        components: [],
        wires: [],
        activeBoardId: null,
      });
      return { ok: true };
    }
    case 'code_get': {
      return getCode();
    }
    case 'code_set': {
      if (typeof cmd.content !== 'string') throw new Error('code_set 参数 content 必须是字符串');
      return setCode({
        content: cmd.content,
        ...(typeof cmd.name === 'string' ? { name: cmd.name } : {}),
      });
    }
    case 'timeline_play': {
      const timeline = normalizeTimeline(cmd.timeline);
      const warnings = Array.isArray(cmd.warnings)
        ? (cmd.warnings as unknown[]).filter((item): item is string => typeof item === 'string')
        : undefined;
      const { durationMs } = playTimeline({
        timeline,
        ...(typeof cmd.explain === 'string' ? { explain: cmd.explain } : {}),
        ...(warnings && warnings.length > 0 ? { warnings } : {}),
      });
      return { durationMs };
    }
    case 'timeline_stop': {
      return { ok: true, stopped: stopTimeline() };
    }
    case 'export_project': {
      return exportProject(typeof cmd.name === 'string' ? { name: cmd.name } : {});
    }
    case 'catalog': {
      const registry = ComponentRegistry.getInstance();
      const boards = Object.entries(BOARD_KIND_LABELS).map(([kind, label]) => ({
        型号: kind,
        名称: label,
      }));
      const components = registry
        .getAllComponents()
        .filter((meta) => meta.category !== 'boards')
        .map((meta) => ({
          型号: meta.id,
          名称: meta.name,
          分类: meta.category,
          参数: (meta.properties ?? []).map((property) => property.name),
        }));
      return { boards, components, count: { boards: boards.length, components: components.length } };
    }
    case 'pins': {
      const ownerId = resolveOwnerId(cmd.owner_id ?? cmd.ref ?? cmd.id);
      const pins = pinsForOwner(ownerId);
      if (!pins) throw new Error('该元件还没有挂载，读不到引脚');
      return { owner_id: ownerId, ...pins };
    }
    case 'json_get': {
      const json = buildCircuitJson();
      return { json, text: JSON.stringify(json, null, 2) };
    }
    case 'validate': {
      const s = useSimulatorStore.getState();
      const result = validateCircuit({
        boards: s.boards as never,
        components: s.components as never,
        wires: s.wires as never,
      });
      // 新增：连线引用的引脚必须真实存在（以前 typo 会被静默接受）。
      const pinIssues: ValidationIssue[] = [];
      for (const wire of s.wires) {
        if (wire.bb) continue;
        const fromMeta = metadataOf(wire.start.componentId);
        const toMeta = metadataOf(wire.end.componentId);
        if (!fromMeta || !resolvePinName(wire.start.componentId, fromMeta, wire.start.pinName)) {
          pinIssues.push({
            code: 'UNKNOWN_PIN',
            severity: 'error',
            message: '有一根线的引脚不存在：' + (fromMeta ?? '?') + ' / ' + wire.start.pinName,
            hint: '删除这根据线并重新连接到真实引脚',
            refs: { wires: [wire.id] },
          });
        }
        if (!toMeta || !resolvePinName(wire.end.componentId, toMeta, wire.end.pinName)) {
          pinIssues.push({
            code: 'UNKNOWN_PIN',
            severity: 'error',
            message: '有一根线的引脚不存在：' + (toMeta ?? '?') + ' / ' + wire.end.pinName,
            hint: '删除这根据线并重新连接到真实引脚',
            refs: { wires: [wire.id] },
          });
        }
      }
      if (pinIssues.length > 0) {
        result.errors.push(...pinIssues);
        result.ok = false;
      }
      return result;
    }
    case 'wire_path': {
      const wireId = String(cmd.wire_id ?? cmd.id ?? '');
      if (!wireId) throw new Error('wire_path 需要 wire_id');
      return { ok: true, ...setWirePath(wireId, cmd.points ?? cmd.路径) };
    }
    case 'autoroute': {
      return { ok: true, ...autoRouteWires(cmd) };
    }
    case 'layout': {
      return { ok: true, ...layoutReport() };
    }
    default:
      throw new Error('未知命令 op: ' + op);
  }
}

export async function executeCommand(command: Json): Promise<CommandOutcome> {
  const op = String(command.op ?? '');
  if (op === 'batch') {
    const commands = Array.isArray(command.commands) ? (command.commands as Json[]) : [];
    const atomic = command.atomic !== false;
    let executed = 0;
    let results: unknown[] = [];
    try {
      for (const cmd of commands) {
        results.push(applyOne(cmd, true));
        executed += 1;
      }
    } catch (err) {
      if (atomic) {
        const store = useSimulatorStore.getState();
        for (let i = 0; i < executed; i += 1) store.undo();
      }
      throw err;
    }
    const outcome = finish();
    return { ...outcome, result: { executed, results } };
  }

  if (op === 'json_apply') {
    const applied = await applyCircuitJson(command.json ?? command.text, {
      ...(typeof command.autoSeat === 'boolean' ? { autoSeat: command.autoSeat } : {}),
    });
    return { ...finish(), result: applied };
  }

  if (op === 'seat') {
    const result = await seatComponent(command);
    return { ...finish(), result };
  }

  const result = applyOne(command, true);
  // 新建板卡 / 元件后等它挂到 DOM，再回一份真实引脚列表给模型。
  if (
    (op === 'place_board' || op === 'place_component') &&
    typeof result === 'object' &&
    result !== null
  ) {
    const created = result as Json;
    if (typeof created.id === 'string') {
      await settleFrames();
      if (op === 'place_component' && typeof command.seat_on === 'string') {
        await alignSeatOnBreadboard(created.id, command.seat_on);
      }
      const pins = pinsForOwner(created.id);
      if (pins) created.pins = pins;
    }
  }
  const outcome = finish();
  return { ...outcome, result };
}
