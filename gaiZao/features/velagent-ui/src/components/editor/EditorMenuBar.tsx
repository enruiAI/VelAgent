/**
 * EditorMenuBar —— 精简版顶栏菜单（File / Edit / View / Help）。
 *
 * 上游菜单里的 Account（登录/我的项目）、编译运行、烧录、分享、PRO 功能等
 * 已经全部删除；这里只保留纯前端能真正执行的命令：
 *   - 文件：新建文件、打开/导入项目、导出 .vlx
 *   - 编辑：撤销 / 重做（画布历史）、格式化文档（Monaco）
 *   - 视图：文件树开关、布局切换（代码/分栏/电路）、缩放、主题
 *   - 帮助：VelAgent 仓库、Discord 社区、上游 Velxio 项目
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { openExternal } from '../../integration/openExternal';
import { useTranslation } from 'react-i18next';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useEditorStore, type EditorViewMode } from '../../store/useEditorStore';
import { useThemeMode } from '../../hooks/useTheme';
import type { ThemeMode } from '../../lib/theme';
import {
  hasEditorCommand,
  runEditorCommand,
  subscribeEditorCommands,
  getEditorCommandsVersion,
  type EditorCommandId,
} from '../../lib/editorCommands';
import './EditorMenuBar.css';

const GITHUB_URL = 'https://github.com/enruiAI/VelAgent';

type Item =
  | { kind: 'command'; id: EditorCommandId; label: string; shortcut?: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'separator' };

type MenuKey = 'file' | 'edit' | 'view' | 'help';

export const EditorMenuBar: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState<MenuKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 命令注册表变化（文件树/画布挂载）时重新渲染，保证菜单项可用态正确。
  useSyncExternalStore(subscribeEditorCommands, getEditorCommandsVersion);

  const explorerOpen = useEditorStore((s) => s.explorerOpen);
  const toggleExplorer = useEditorStore((s) => s.toggleExplorer);
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const [themeMode, setThemeMode] = useThemeMode();
  const undo = useSimulatorStore((s) => s.undo);
  const redo = useSimulatorStore((s) => s.redo);
  const history = useSimulatorStore((s) => s.history);
  const historyIndex = useSimulatorStore((s) => s.historyIndex);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fileItems: Item[] = [
    { kind: 'command', id: 'file.new', label: t('editor.menu.newFile', '新建文件') },
    { kind: 'command', id: 'project.open', label: t('editor.menu.open', '打开/导入项目…') },
    { kind: 'separator' },
    { kind: 'command', id: 'project.exportVlx', label: t('editor.toolbar.exportVlxLabel', '导出项目 (.vlx)') },
  ];

  const viewItems: Item[] = [
    { kind: 'command', id: 'view.reset', label: t('editor.menu.centerView', '画布居中') },
    { kind: 'command', id: 'view.zoomIn', label: t('editor.canvas.zoomIn', '放大') },
    { kind: 'command', id: 'view.zoomOut', label: t('editor.canvas.zoomOut', '缩小') },
  ];

  // 用户要求：帮助菜单只保留仓库入口（去掉 Discord / 上游站点）。
  const helpItems: Item[] = [
    { kind: 'link', href: GITHUB_URL, label: t('editor.menu.github', 'VelAgent GitHub 仓库') },
  ];

  const layoutModes: { key: EditorViewMode; label: string }[] = [
    { key: 'code', label: t('editor.shell.code', '代码') },
    { key: 'both', label: t('editor.shell.both', '分栏') },
    { key: 'circuit', label: t('editor.shell.circuit', '电路') },
    { key: 'json', label: t('editor.shell.json', 'JSON') },
  ];

  const themeModes: { key: ThemeMode; label: string }[] = [
    { key: 'dark', label: t('editor.menu.themeDark', '深色') },
    { key: 'light', label: t('editor.menu.themeLight', '浅色') },
    { key: 'system', label: t('editor.menu.themeSystem', '跟随系统') },
  ];

  const renderCommand = (item: Extract<Item, { kind: 'command' }>): React.ReactNode => (
    <button
      key={item.id}
      role="menuitem"
      className="emb-item"
      disabled={!hasEditorCommand(item.id)}
      onClick={() => {
        setOpen(null);
        runEditorCommand(item.id);
      }}
    >
      <span>{item.label}</span>
      {item.shortcut && <span className="emb-shortcut">{item.shortcut}</span>}
    </button>
  );

  const renderLink = (item: Extract<Item, { kind: 'link' }>): React.ReactNode => (
    <a
      key={item.href}
      role="menuitem"
      className="emb-item"
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        setOpen(null);
        openExternal(item.href);
      }}
    >
      <span>{item.label}</span>
    </a>
  );

  const renderItems = (items: Item[]): React.ReactNode =>
    items.map((item, i) => {
      if (item.kind === 'separator') return <div key={`sep-${i}`} className="emb-separator" />;
      if (item.kind === 'link') return renderLink(item);
      if (item.id === 'edit.formatDocument' && !hasEditorCommand(item.id)) return null;
      return renderCommand(item);
    });

  const menu = (which: MenuKey, label: string, items: Item[]): React.ReactNode => (
    <div className="emb-root" key={which}>
      <button
        className={`emb-trigger${open === which ? ' emb-trigger-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open === which}
        onClick={() => setOpen((cur) => (cur === which ? null : which))}
        onMouseEnter={() => setOpen((cur) => (cur && cur !== which ? which : cur))}
      >
        {label}
      </button>
      {open === which && (
        <div className="emb-menu" role="menu">
          {which === 'edit' && (
            <>
              <button
                role="menuitem"
                className="emb-item"
                disabled={historyIndex < 0}
                onClick={() => { setOpen(null); undo(); }}
              >
                <span>{t('editor.menu.undo', '撤销')}</span>
                <span className="emb-shortcut">Ctrl+Z</span>
              </button>
              <button
                role="menuitem"
                className="emb-item"
                disabled={historyIndex >= history.length - 1}
                onClick={() => { setOpen(null); redo(); }}
              >
                <span>{t('editor.menu.redo', '重做')}</span>
                <span className="emb-shortcut">Ctrl+Y</span>
              </button>
              <div className="emb-separator" />
              <button
                role="menuitem"
                className="emb-item"
                disabled={!hasEditorCommand('edit.formatDocument')}
                onClick={() => { setOpen(null); runEditorCommand('edit.formatDocument'); }}
              >
                <span>{t('editor.menu.formatDocument', '格式化文档')}</span>
                <span className="emb-shortcut">Shift+Alt+F</span>
              </button>
            </>
          )}

          {which === 'view' && (
            <>
              <div className="emb-section-label">{t('editor.shell.viewMode', '视图布局')}</div>
              <button
                role="menuitemcheckbox"
                aria-checked={explorerOpen}
                className="emb-item"
                onClick={() => { setOpen(null); toggleExplorer(); }}
              >
                <span>{t('editor.menu.toggleExplorer', '文件树')}</span>
                <span className="emb-shortcut">{explorerOpen ? '✓' : ''}</span>
              </button>
              {layoutModes.map((m) => (
                <button
                  key={m.key}
                  role="menuitemradio"
                  aria-checked={viewMode === m.key}
                  className="emb-item"
                  onClick={() => { setOpen(null); setViewMode(m.key); }}
                >
                  <span>{m.label}</span>
                  <span className="emb-shortcut">{viewMode === m.key ? '✓' : ''}</span>
                </button>
              ))}
              <div className="emb-separator" />
              <div className="emb-section-label">{t('editor.menu.appearance', '外观')}</div>
              {themeModes.map((m) => (
                <button
                  key={m.key}
                  role="menuitemradio"
                  aria-checked={themeMode === m.key}
                  className="emb-item"
                  onClick={() => { setOpen(null); setThemeMode(m.key); }}
                >
                  <span>{m.label}</span>
                  <span className="emb-shortcut">{themeMode === m.key ? '✓' : ''}</span>
                </button>
              ))}
              <div className="emb-separator" />
            </>
          )}

          {renderItems(items)}
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="editor-menubar" role="menubar">
      {menu('file', t('editor.menu.file', '文件'), fileItems)}
      {menu('edit', t('editor.menu.edit', '编辑'), [])}
      {menu('view', t('editor.menu.view', '视图'), viewItems)}
      {menu('help', t('editor.menu.help', '帮助'), helpItems)}
    </div>
  );
};
