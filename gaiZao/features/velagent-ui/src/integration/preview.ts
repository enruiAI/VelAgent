/**
 * AI 运行预测（M3）：
 * - 桌面端且配置了 AI：把「电路 + 代码」发给模型，拿回行为剧本（时间轴）；
 * - 否则 / 失败：用规则兜底（解析 digitalWrite/delay/Serial），保证离线也能演示。
 *
 * 播放逻辑在 ./playback（不依赖 Tauri），这里只负责「生成剧本」并 re-export
 * 播放 API，保持 EditorPage 等既有 import 不变。
 */
import { isDesktop, requestAiPreview } from './controlBridge';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { playPlaybook, resetLeds, type Playbook, type TimelineEvent } from './playback';

export { playPlaybook, resetLeds };
export type { Playbook, TimelineEvent };

export interface RunInput {
  code: string;
  language: string;
  boardKind?: string;
}

export async function getPlaybook(input: RunInput): Promise<Playbook> {
  if (isDesktop()) {
    try {
      const s = useSimulatorStore.getState();
      const circuit = {
        boards: s.boards.map((b) => ({ id: b.id, kind: b.boardKind, x: b.x, y: b.y })),
        components: s.components.map((c) => ({ id: c.id, metadata_id: c.metadataId, x: c.x, y: c.y })),
        wires: s.wires.map((w) => ({
          id: w.id,
          from: { owner_id: w.start.componentId, pin: w.start.pinName },
          to: { owner_id: w.end.componentId, pin: w.end.pinName },
        })),
      };
      const raw = (await requestAiPreview({
        code: input.code,
        language: input.language,
        circuit,
        board_kind: input.boardKind,
      })) as { timeline?: TimelineEvent[]; explain?: string; warnings?: string[] };
      if (raw && Array.isArray(raw.timeline) && raw.timeline.length > 0) {
        return { timeline: raw.timeline, explain: raw.explain, warnings: raw.warnings, source: 'ai' };
      }
    } catch (err) {
      console.warn('[velagent] AI 预览失败，使用规则兜底', err);
    }
  }
  return fallbackPlaybook(input.code);
}

function parseMs(text: string): number | null {
  const m = /delay\((\d+)\)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** 规则兜底：识别 Blink / 串口输出这类最常见的新手代码 */
export function fallbackPlaybook(code: string): Playbook {
  const leds = useSimulatorStore
    .getState()
    .components.filter((c) => c.metadataId === 'led')
    .map((c) => c.id);
  const lines = code.split(/\r?\n/);
  const timeline: TimelineEvent[] = [];
  let t = 0;
  let state = false;
  let sawGpio = false;
  let sawSerial = false;

  const applyAll = (on: boolean) => {
    if (leds.length === 0) return {};
    const map: Record<string, boolean> = {};
    for (const id of leds) map[id] = on;
    return map;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const ms = parseMs(line);
    if (ms !== null) {
      t += ms;
      continue;
    }
    if (/digitalWrite\s*\(/.test(line)) {
      sawGpio = true;
      const m = /digitalWrite\s*\(([^,]+),\s*(HIGH|LOW)\s*\)/.exec(line);
      if (m) {
        state = m[2] === 'HIGH';
        timeline.push({ t, leds: applyAll(state), note: m[1].trim() + ' = ' + m[2] });
      }
      continue;
    }
    const serial = /Serial\.println\s*\(\s*"([^"]*)"\s*\)/.exec(line);
    if (serial) {
      sawSerial = true;
      timeline.push({ t, serial: serial[1] });
    }
  }

  if (timeline.length === 0) {
    timeline.push({ t: 0, note: '未能从代码中识别出可演示的动作' });
  }

  const explainParts: string[] = [];
  if (sawGpio) explainParts.push('识别到 GPIO 输出（digitalWrite），按 delay 时长还原灯的状态变化。');
  if (sawSerial) explainParts.push('识别到串口输出，已按时间顺序列出。');
  if (leds.length === 0) explainParts.push('当前画布没有 LED，动画只会体现在串口/提示上。');
  explainParts.push('这是本地规则预测（未调用 AI），用于离线演示。');

  return {
    timeline,
    explain: explainParts.join(' '),
    warnings: [],
    source: 'rules',
  };
}
