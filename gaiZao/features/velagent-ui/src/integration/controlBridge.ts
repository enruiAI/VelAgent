/**
 * 桌面端桥接：React（WebView）↔ Rust（Tauri）。
 *
 * - 浏览器预览时全部降级为 no-op；
 * - 画布状态 → Rust 镜像（供 AI 读取）；
 * - Rust 把 AI 的写命令通过 event 下发 → 前端执行 → 回传结果与最新状态。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { serializeWorkspace } from './workspaceState';

export interface ControlInfo {
  port: number;
  token: string;
  aiCanWrite: boolean;
  version: string;
}

export interface AiSettingsView {
  provider: string;
  base_url: string;
  model: string;
  has_key: boolean;
  can_write: boolean;
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);
}

export async function getControlInfo(): Promise<ControlInfo | null> {
  if (!isDesktop()) return null;
  try {
    const raw = await invoke<{ port: number; token: string; ai_can_write: boolean; version: string }>('get_control_info');
    return { port: raw.port, token: raw.token, aiCanWrite: raw.ai_can_write, version: raw.version };
  } catch (err) {
    console.warn('[velagent] get_control_info failed', err);
    return null;
  }
}

export async function setAiCanWrite(enabled: boolean): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    return await invoke<boolean>('set_ai_can_write', { enabled });
  } catch (err) {
    console.warn('[velagent] set_ai_can_write failed', err);
    return false;
  }
}

export async function rotateToken(): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<string>('rotate_token');
  } catch (err) {
    console.warn('[velagent] rotate_token failed', err);
    return null;
  }
}

// 快照实现落在 workspaceState.ts（不依赖 Tauri，供浏览器端 embed 复用），
// 这里 re-export 保持 controlBridge 原有的 serializeWorkspace 导出不变。
export { serializeWorkspace };

let started = false;

/** 启动：画布状态同步 + 命令通道 + 目录上报。只调用一次。 */
export function startWorkspaceSync(): void {
  if (!isDesktop() || started) return;
  started = true;

  let timer: number | undefined;
  let lastError = '';
  const push = async () => {
    try {
      await invoke<number>('sync_workspace', { workspace: serializeWorkspace() });
      lastError = '';
    } catch (err) {
      const text = String(err);
      if (text !== lastError) {
        lastError = text;
        console.warn('[velagent] sync_workspace failed', err);
      }
    }
  };

  useSimulatorStore.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void push(), 250);
  });
  void push();

  // AI 写命令通道（Rust → 前端）
  void listen<{ id: number; command: Record<string, unknown> }>('velagent://command', async (event) => {
    const { id, command } = event.payload;
    try {
      const { executeCommand } = await import('./commands');
      const outcome = await executeCommand(command);
      await invoke('command_result', {
        id,
        ok: true,
        error: null,
        workspace: outcome.workspace,
        result: outcome.result ?? null,
      });
    } catch (err) {
      await invoke('command_result', {
        id,
        ok: false,
        error: String((err as Error)?.message ?? err),
        workspace: null,
        result: null,
      });
    }
  }).catch((err) => console.warn('[velagent] listen command failed', err));

  // 上报真实目录（板卡/元件），让控制面 catalog 与实际界面一致
  void (async () => {
    try {
      const { syncCatalog } = await import('./catalogSync');
      await syncCatalog();
    } catch (err) {
      console.warn('[velagent] sync_catalog failed', err);
    }
  })();
}

// ── AI 配置 / 预览 ──────────────────────────────────────────────────────────

export async function getAiSettings(): Promise<AiSettingsView | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<AiSettingsView>('get_ai_config');
  } catch {
    return null;
  }
}

export async function saveAiSettings(settings: {
  provider: string;
  base_url: string;
  model: string;
  api_key?: string;
}): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    return await invoke<boolean>('save_ai_config', { settings });
  } catch {
    return false;
  }
}

export async function testAiConnection(): Promise<{ ok: boolean; reply?: string; error?: string }> {
  if (!isDesktop()) return { ok: false, error: '仅桌面端可用' };
  try {
    const res = await invoke<{ ok: boolean; reply: string }>('test_ai_connection');
    return res;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function requestAiPreview(request: {
  code: string;
  language: string;
  circuit: unknown;
  board_kind?: string;
}): Promise<unknown> {
  if (!isDesktop()) throw new Error('AI 预览需要桌面端');
  return invoke('ai_preview', { request });
}
