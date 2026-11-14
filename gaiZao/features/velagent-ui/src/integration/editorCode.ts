/**
 * 编辑器代码读写：embed API（getCode/setCode）与命令 op（code_get/code_set）共用。
 *
 * 只操作 useEditorStore 的活动文件组（与 Monaco 标签栏、文件树看到的是同一份状态），
 * 不依赖 Tauri，可在 Harness dock 里安全调用。
 */
import { useEditorStore } from '../store/useEditorStore';

/** 编辑器当前内容：活动文件名 + 活动文件组里的全部文件。 */
export interface CodeSnapshot {
  active: string | null;
  files: Array<{ name: string; content: string }>;
}

/** @returns 当前编辑器里的活动文件名与全部文件内容（纯 JSON）。 */
export function getCode(): CodeSnapshot {
  const state = useEditorStore.getState();
  const active = state.files.find((file) => file.id === state.activeFileId);
  return {
    active: active?.name ?? null,
    files: state.files.map((file) => ({ name: file.name, content: file.content })),
  };
}

/**
 * 写入代码：name 省略时写当前活动文件；name 不存在时新建同名文件再写入。
 * @param update - name（可选）与 content。
 * @returns 实际写入的文件名。
 */
export function setCode(update: { name?: string; content: string }): { name: string } {
  if (typeof update.content !== 'string') throw new Error('code_set 需要字符串 content');
  const name = typeof update.name === 'string' ? update.name.trim() : '';
  const state = useEditorStore.getState();

  if (!name) {
    const active = state.files.find((file) => file.id === state.activeFileId) ?? state.files[0];
    if (!active) throw new Error('编辑器里没有可写入的文件');
    state.setFileContent(active.id, update.content);
    return { name: active.name };
  }

  const existing = state.files.find((file) => file.name === name);
  if (existing) {
    state.setFileContent(existing.id, update.content);
    return { name: existing.name };
  }

  const id = state.createFile(name);
  useEditorStore.getState().setFileContent(id, update.content);
  return { name };
}
