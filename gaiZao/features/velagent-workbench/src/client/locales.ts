/** `velagent` namespace dictionaries: dock chrome and launcher copy. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'velagent'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'launcher.header.label': 'VelAgent 工作台',
  'launcher.header.title': '打开 VelAgent 工作台',
  'launcher.footer.label': 'VelAgent',
  'launcher.footer.title': '打开 VelAgent 工作台',
  'dock.title': 'VelAgent 工作台',
  'dock.aria': 'VelAgent 工作台',
  'dock.close': '关闭',
  'dock.resizeAria': '拖动调整面板宽度',
  'status.connected': '已连接',
  'status.connecting': '连接中',
  'status.closed': '未连接',
  'status.error': '错误',
  'canvas.loading': '正在加载 VelAgent 工作台…',
  'canvas.error': '工作台加载失败，关闭后重新打开可重试。',
  'workspace.legacy': '当前 VelAgent 画布组件为旧版本，仅显示电路画布；更新 VelAgent 后可使用完整工作台。',
  'aiRun.prompt': '现在对本轮做一次新的试运行，不要引用历史结果：1) 必须调用 velagent_read_circuit（full:true）读取当前画布；2) 必须调用 velagent_read_code 读取当前代码；3) 依据代码里的 digitalWrite/delay/Serial 生成时间轴，并调用 velagent_play_timeline 播放；4) 最后用中文简短说明运行结果。任何工具报错请把原始错误信息贴出来。',
} as const

/** Key domain of the `velagent` namespace (Chinese is the source of truth). */
export type VelagentKey = keyof typeof zh

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<VelagentKey, string> = {
  'launcher.header.label': 'VelAgent workbench',
  'launcher.header.title': 'Open the VelAgent workbench',
  'launcher.footer.label': 'VelAgent',
  'launcher.footer.title': 'Open the VelAgent workbench',
  'dock.title': 'VelAgent workbench',
  'dock.aria': 'VelAgent workbench',
  'dock.close': 'Close',
  'dock.resizeAria': 'Resize the panel',
  'status.connected': 'Connected',
  'status.connecting': 'Connecting',
  'status.closed': 'Disconnected',
  'status.error': 'Error',
  'canvas.loading': 'Loading the VelAgent workbench…',
  'canvas.error': 'The workbench failed to load. Close and reopen the dock to retry.',
  'workspace.legacy': 'This VelAgent build is older and shows the circuit canvas only. Update VelAgent to use the full workbench.',
  'aiRun.prompt': 'Run a fresh trial now and ignore earlier results: 1) you must call velagent_read_circuit (full:true) for the current canvas; 2) you must call velagent_read_code for the current code; 3) derive a timeline from digitalWrite/delay/Serial and call velagent_play_timeline; 4) explain the outcome briefly in Chinese. Paste any raw tool error verbatim.',
}
