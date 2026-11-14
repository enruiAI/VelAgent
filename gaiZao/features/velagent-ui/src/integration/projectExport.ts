/**
 * 纯前端项目导出：把当前画布 + 代码打包成 .vlx JSON 并触发浏览器下载。
 *
 * 独立版菜单和 Harness dock 的「导出项目」按钮共用；embed API 与
 * export_project 命令都走这里。
 */
import { triggerDownloadVlx } from '../utils/vlxFile';

/**
 * 导出当前项目。
 * @param options - name：导出文件名（不含 .vlx 后缀，省略用默认名）。
 * @returns name：浏览器实际使用的文件名（含 .vlx 后缀）。
 */
export function exportProject(options: { name?: string } = {}): { name: string } {
  return { name: triggerDownloadVlx({ name: options.name }) };
}
