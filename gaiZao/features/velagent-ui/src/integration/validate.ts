/**
 * 接线校验（M1）：纯前端规则，基于画布上的 wires 图。
 *
 * 规则目标：挡住新手最常见的错误，用中文说清楚「哪根线错了、为什么、怎么改」。
 * 规则不依赖仿真，也不依赖后端。
 */
import type { BoardInstance, BoardKind } from '../types/board';
import type { Component } from '../types/component';
import type { Wire } from '../types/wire';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  hint?: string;
  refs?: { boards?: string[]; components?: string[]; wires?: string[] };
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface CircuitSnapshot {
  boards: BoardInstance[];
  components: Component[];
  wires: Wire[];
}

const GND_RE = /(^|[._-])gnd|ground/i;
const VCC_RE = /^(3v3|3\.3v|5v|vcc|vin|vbus|vdd)/i;
const GPIO_RE = /^(d\d+|a\d+|gp\d+|gpio\d+|\d+)$/i;

export function boardPinRole(pin: string): 'gnd' | 'vcc' | 'gpio' | 'other' {
  if (GND_RE.test(pin)) return 'gnd';
  if (VCC_RE.test(pin)) return 'vcc';
  if (GPIO_RE.test(pin)) return 'gpio';
  return 'other';
}

/** 元件引脚语义（只覆盖教学里常用的元件） */
export function componentPinRole(metadataId: string, pin: string): 'anode' | 'cathode' | 'passive' | 'sig' | 'other' {
  if (metadataId === 'led' || metadataId.startsWith('rgb-led') || metadataId === 'led-ring' || metadataId === 'neopixel') {
    if (pin === 'A' || pin === 'DIN' || pin === 'DI') return 'anode';
    if (pin === 'C' || pin === 'DOUT' || pin === 'DO') return 'cathode';
    return 'other';
  }
  if (metadataId.startsWith('resistor')) return 'passive';
  if (metadataId === 'buzzer' || metadataId === 'servo') return 'passive';
  if (metadataId === 'pushbutton' || metadataId.startsWith('pushbutton')) return 'sig';
  return 'other';
}

interface PinKey {
  ownerId: string;
  pin: string;
}

function key(p: PinKey): string {
  return p.ownerId + '::' + p.pin;
}

/** 并查集：把导线两端合进同一个 net */
class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
      return x;
    }
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

export function validateCircuit(snapshot: CircuitSnapshot): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const { boards, components, wires } = snapshot;
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const compById = new Map(components.map((c) => [c.id, c]));

  const uf = new UnionFind();
  const pinWireCount = new Map<string, number>();
  const wiresOfOwner = new Map<string, Wire[]>();

  for (const wire of wires) {
    const start: PinKey = { ownerId: wire.start.componentId, pin: wire.start.pinName };
    const end: PinKey = { ownerId: wire.end.componentId, pin: wire.end.pinName };
    const sk = key(start);
    const ek = key(end);
    pinWireCount.set(sk, (pinWireCount.get(sk) ?? 0) + 1);
    pinWireCount.set(ek, (pinWireCount.get(ek) ?? 0) + 1);
    uf.union(sk, ek);
    for (const ownerId of [start.ownerId, end.ownerId]) {
      const list = wiresOfOwner.get(ownerId) ?? [];
      list.push(wire);
      wiresOfOwner.set(ownerId, list);
    }
    for (const p of [start, end]) {
      if (!boardById.has(p.ownerId) && !compById.has(p.ownerId)) {
        errors.push({
          code: 'UNKNOWN_OWNER',
          severity: 'error',
          message: '有一根线连到了不存在的板卡/元件：' + p.ownerId,
          hint: '删除该线并重新连接',
          refs: { wires: [wire.id] },
        });
      }
    }
  }

  // 同一引脚接多根线
  for (const [pinKey, count] of pinWireCount) {
    if (count <= 1) continue;
    const [ownerId, pin] = pinKey.split('::');
    warnings.push({
      code: 'PIN_IN_USE',
      severity: 'warning',
      message: '引脚 ' + pin + ' 上接了 ' + count + ' 根线（同一引脚并联）',
      hint: '确认这是有意为之；新手常见错误是误接到同一排不同孔',
      refs: { boards: boardById.has(ownerId) ? [ownerId] : [], components: compById.has(ownerId) ? [ownerId] : [] },
    });
  }

  // 找 net 里是否有板卡引脚
  const nets = new Map<string, { gnd: boolean; vcc: boolean; gpio: boolean; boardPins: PinKey[] }>();
  const collectNet = (root: string) => {
    let entry = nets.get(root);
    if (entry) return entry;
    entry = { gnd: false, vcc: false, gpio: false, boardPins: [] };
    const visit = (k: string) => {
      const [ownerId, pin] = k.split('::');
      if (boardById.has(ownerId)) {
        const role = boardPinRole(pin);
        entry!.boardPins.push({ ownerId, pin });
        if (role === 'gnd') entry!.gnd = true;
        if (role === 'vcc') entry!.vcc = true;
        if (role === 'gpio') entry!.gpio = true;
      }
    };
    // 遍历导线图找同 net 的所有引脚
    const queue: string[] = [];
    for (const wire of wires) {
      const s = key({ ownerId: wire.start.componentId, pin: wire.start.pinName });
      const e = key({ ownerId: wire.end.componentId, pin: wire.end.pinName });
      if (uf.find(s) === root) queue.push(s, e);
    }
    const seen = new Set<string>();
    while (queue.length) {
      const k = queue.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      visit(k);
    }
    nets.set(root, entry);
    return entry;
  };

  const netOf = (ownerId: string, pin: string) => {
    const k = key({ ownerId, pin });
    const root = uf.find(k);
    return collectNet(root);
  };

  // 直接短路：板卡 VCC 与 GND 同一根线
  for (const wire of wires) {
    const a = { ownerId: wire.start.componentId, pin: wire.start.pinName };
    const b = { ownerId: wire.end.componentId, pin: wire.end.pinName };
    if (!boardById.has(a.ownerId) || !boardById.has(b.ownerId)) continue;
    const ra = boardPinRole(a.pin);
    const rb = boardPinRole(b.pin);
    if ((ra === 'vcc' && rb === 'gnd') || (ra === 'gnd' && rb === 'vcc')) {
      errors.push({
        code: 'SHORT_RISK',
        severity: 'error',
        message: '电源与地直接相连（短路风险）',
        hint: '电源必须经过元件才能回到地；请删除这根线',
        refs: { wires: [wire.id] },
      });
    }
    if ((ra === 'gpio' && rb === 'gnd') || (ra === 'gnd' && rb === 'gpio')) {
      errors.push({
        code: 'GPIO_TO_GND',
        severity: 'error',
        message: 'GPIO ' + (ra === 'gpio' ? a.pin : b.pin) + ' 被直接接到 GND',
        hint: 'GPIO 需要经过限流电阻/元件再接地，直接接 GND 没有意义且会短路输出',
        refs: { wires: [wire.id] },
      });
    }
  }

  // LED 相关规则
  const leds = components.filter((c) => c.metadataId === 'led');

  /** LED 的信号侧（直接或隔一个元件）是否串了电阻 */
  const hasResistorFor = (ledId: string): boolean => {
    const attached = wiresOfOwner.get(ledId) ?? [];
    for (const w of attached) {
      const other = w.start.componentId === ledId ? w.end : w.start;
      const otherComp = compById.get(other.componentId);
      if (!otherComp) continue;
      if (otherComp.metadataId.startsWith('resistor')) return true;
      for (const w2 of wiresOfOwner.get(otherComp.id) ?? []) {
        const o2 = w2.start.componentId === otherComp.id ? w2.end : w2.start;
        const c2 = compById.get(o2.componentId);
        if (c2 && c2.metadataId.startsWith('resistor')) return true;
      }
    }
    return false;
  };

  for (const led of leds) {
    const attached = wiresOfOwner.get(led.id) ?? [];
    if (attached.length === 0) {
      warnings.push({
        code: 'LED_UNCONNECTED',
        severity: 'warning',
        message: 'LED（' + led.id + '）还没有接线',
        hint: 'LED 长脚（A）接信号，短脚（C）经电阻接 GND',
        refs: { components: [led.id] },
      });
      continue;
    }
    const hasAnode = attached.some((w) => (w.start.componentId === led.id && w.start.pinName === 'A') || (w.end.componentId === led.id && w.end.pinName === 'A'));
    const hasCathode = attached.some((w) => (w.start.componentId === led.id && w.start.pinName === 'C') || (w.end.componentId === led.id && w.end.pinName === 'C'));
    const anodeNetEarly = hasAnode ? netOf(led.id, 'A') : null;
    if (anodeNetEarly && anodeNetEarly.gpio && !hasResistorFor(led.id)) {
      errors.push({
        code: 'MISSING_RESISTOR',
        severity: 'error',
        message: 'LED（' + led.id + '）的信号侧没有串联限流电阻',
        hint: '在 GPIO 与 LED 长脚（A）之间串一个 220Ω–1kΩ 电阻，否则 LED 可能烧坏',
        refs: { components: [led.id] },
      });
    }
    if (!hasAnode || !hasCathode) {
      const missing = !hasAnode ? 'A（长脚/正极）' : 'C（短脚/负极）';
      warnings.push({
        code: 'LED_PIN_OPEN',
        severity: 'warning',
        message: 'LED（' + led.id + '）的 ' + missing + ' 还没接',
        hint: 'LED 两端都要接：A 接信号（经电阻），C 接 GND',
        refs: { components: [led.id] },
      });
      continue;
    }
    const anodeNet = netOf(led.id, 'A');
    const cathodeNet = netOf(led.id, 'C');
    if (anodeNet.gnd && cathodeNet.gpio) {
      errors.push({
        code: 'LED_REVERSED',
        severity: 'error',
        message: 'LED（' + led.id + '）可能接反了：长脚（A）接到了 GND，短脚（C）接到了信号',
        hint: 'LED 长脚是正极（A），应接 GPIO 一侧；短脚（C）接 GND',
        refs: { components: [led.id] },
      });
    }
    if (anodeNet.gpio && !anodeNet.gnd) {
      // 检查从 GPIO 到 LED 的路径上是否有电阻
      if (!hasResistorFor(led.id)) {
        errors.push({
          code: 'MISSING_RESISTOR',
          severity: 'error',
          message: 'LED（' + led.id + '）没有串联限流电阻',
          hint: '在 GPIO 与 LED 长脚之间串一个 220Ω–1kΩ 电阻，否则 LED 可能烧坏',
          refs: { components: [led.id] },
        });
      }
    }
  }

  // 是否共地
  const usesGround = wires.some((w) => {
    const a = boardById.get(w.start.componentId);
    const b = boardById.get(w.end.componentId);
    return (a && boardPinRole(w.start.pinName) === 'gnd') || (b && boardPinRole(w.end.pinName) === 'gnd');
  });
  if (wires.length > 0 && !usesGround) {
    warnings.push({
      code: 'NO_GROUND',
      severity: 'warning',
      message: '电路里没有找到公共地（GND）',
      hint: '所有元件都要与板卡共地：把 LED 短脚/蜂鸣器负极等接回板卡 GND',
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}
