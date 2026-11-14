/**
 * 行为时间轴播放：把一段 `{ t, leds, serial, note }` 剧本定时落到画布上。
 *
 * 本模块刻意不 import `./controlBridge`（会拖入 @tauri-apps/api）：
 * Harness embed 包直接引用它，桌面端与浏览器端共用同一份播放逻辑。
 * AI / 规则兜底生成剧本留在 preview.ts（那是桌面端能力）。
 */
import { useSimulatorStore } from '../store/useSimulatorStore';

/** 时间轴上的一条事件：在 t 毫秒时把 LED 置为给定状态，并（或）输出一行串口。 */
export interface TimelineEvent {
  t: number;
  leds?: Record<string, boolean>;
  serial?: string;
  note?: string;
}

/** 一段可播放的行为剧本。embed 的 playTimeline() 和桌面端的 AI 预览共用。 */
export interface Playbook {
  timeline: TimelineEvent[];
  explain?: string;
  warnings?: string[];
  /** 剧本来源；embed 播放外部传入的剧本时可以没有。 */
  source?: 'ai' | 'rules';
}

/** 播放回调：每条事件触发一次，全部播完后触发一次 onDone。 */
export interface PlaybookHandlers {
  onEvent: (event: TimelineEvent) => void;
  onDone: () => void;
}

/** 播放剧本；返回停止函数（不恢复 LED，需要时调用 resetLeds）。 */
export function playPlaybook(playbook: Playbook, handlers: PlaybookHandlers): () => void {
  const timers: number[] = [];
  const events = playbook.timeline ?? [];
  const last = events[events.length - 1]?.t ?? 0;
  for (const event of events) {
    timers.push(window.setTimeout(() => handlers.onEvent(event), Math.max(0, event.t)));
  }
  timers.push(window.setTimeout(() => handlers.onDone(), Math.max(0, last) + 800));
  return () => timers.forEach((id) => window.clearTimeout(id));
}

/** 停止时把所有 LED 恢复到熄灭。 */
export function resetLeds(): void {
  const store = useSimulatorStore.getState();
  for (const comp of store.components) {
    if (comp.metadataId === 'led' && comp.properties.state) {
      store.updateComponentState(comp.id, false);
    }
  }
}

/**
 * 追加一行串口输出到当前画布的串口缓冲区（与 SerialMonitor 读的是同一份状态）。
 * 播放剧本时没有真实仿真器，直接写 store 的 serialOutput。
 */
function appendSerialLine(text: string): void {
  const state = useSimulatorStore.getState();
  const boardId = state.activeBoardId ?? state.boards[0]?.id;
  const line = text.endsWith('\n') ? text : text + '\n';
  useSimulatorStore.setState((s) => ({
    serialOutput: s.serialOutput + line,
    boards: boardId ? s.boards.map((b) => (b.id === boardId ? { ...b, serialOutput: b.serialOutput + line } : b)) : s.boards,
  }));
}

/** 把一条时间轴事件写进画布：LED 开关 + 串口输出。 */
export function applyTimelineEvent(event: TimelineEvent): void {
  const store = useSimulatorStore.getState();
  if (event.leds) {
    for (const [id, on] of Object.entries(event.leds)) store.updateComponentState(id, on);
  }
  if (event.serial) appendSerialLine(event.serial);
}

/** 正在播放的停止函数；同一时间只允许一段剧本，新播放会先停掉旧的。 */
let activeStop: (() => void) | null = null;

/** @returns 当前是否有剧本正在播放。 */
export function isTimelinePlaying(): boolean {
  return activeStop !== null;
}

/**
 * 停止当前播放（如有），并熄灭所有 LED。
 * @returns 是否确实停掉了一段正在播放的剧本。
 */
export function stopTimeline(): boolean {
  const stop = activeStop;
  if (!stop) return false;
  stop();
  return true;
}

/**
 * 播放一段剧本：按 t 定时设置 LED 状态并把 serial 事件追加到串口输出。
 * @param playbook - 待播放的时间轴。
 * @returns stop（幂等停止、熄灭 LED）与 durationMs（最后一条事件的时间）。
 */
export function playTimeline(playbook: Playbook): { stop: () => void; durationMs: number } {
  stopTimeline();
  const events = (playbook.timeline ?? [])
    .filter((event) => Number.isFinite(event?.t))
    .slice()
    .sort((a, b) => a.t - b.t);
  const durationMs = events.length > 0 ? Math.max(0, events[events.length - 1].t) : 0;
  let stopped = false;
  const stopOnce = (): void => {
    if (stopped) return;
    stopped = true;
    cancel();
    resetLeds();
    if (activeStop === stopOnce) activeStop = null;
  };
  const cancel = playPlaybook({ timeline: events }, {
    onEvent: (event) => applyTimelineEvent(event),
    onDone: () => {
      if (activeStop === stopOnce) activeStop = null;
    },
  });
  activeStop = stopOnce;
  return { stop: stopOnce, durationMs };
}
