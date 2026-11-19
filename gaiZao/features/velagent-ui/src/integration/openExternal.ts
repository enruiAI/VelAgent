/**
 * 在系统默认浏览器里打开外部链接。
 *
 * Tauri 的 WebView 默认会拦掉 <a target="_blank"> 的外链导航（点了没反应），
 * 所以统一走 Rust 的 open_url 命令；浏览器预览时退化为 window.open。
 */
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './controlBridge';

export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (isDesktop()) {
    void invoke<boolean>('open_url', { url }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
