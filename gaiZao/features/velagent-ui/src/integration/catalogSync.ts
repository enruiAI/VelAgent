/** 把界面上真实可用的板卡/元件目录上报给 Rust（供 AI 查询，避免编造 id）。 */
import { invoke } from '@tauri-apps/api/core';
import { BOARD_KIND_LABELS, type BoardKind } from '../types/board';
import { ComponentRegistry } from '../lib/ComponentRegistry';
import { isDesktop } from './controlBridge';

export async function syncCatalog(): Promise<void> {
  if (!isDesktop()) return;
  const boards = (Object.keys(BOARD_KIND_LABELS) as BoardKind[]).map((id) => ({
    id,
    name: BOARD_KIND_LABELS[id],
    category: 'boards',
  }));
  const components = ComponentRegistry.getInstance().getAllComponents().map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    pin_count: c.pinCount,
  }));
  await invoke('sync_catalog', { catalog: { boards, components } });
}
