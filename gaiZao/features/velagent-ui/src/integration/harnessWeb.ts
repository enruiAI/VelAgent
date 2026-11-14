/** 打开内嵌的官方 DeepSeek Harness 界面（插件 / 设置 / 完整对话）。 */
import { invoke } from '@tauri-apps/api/core';

export interface HarnessWebStatusView {
  running: boolean;
  port: number;
  url: string;
  error?: string | null;
}

export async function openHarnessWindow(): Promise<HarnessWebStatusView> {
  const status = await invoke<HarnessWebStatusView>('harness_web_start');
  await invoke('harness_web_open');
  return status;
}
