/**
 * 共享工作区文件树：mountWorkspace 拿到 WorkspaceProvider 时替代内置文件树。
 *
 * - 头部只显示 Harness 会话工作区的文件夹名（不显示标题/caption/完整路径）；
 * - VSCode 式操作：新建文件 / 新建文件夹（头部按钮，inline input，Enter 确认 /
 *   Esc 取消，非法名称就地提示）、行 hover 出重命名/删除（删除需二次确认）；
 * - provider 没提供 mkdir/rename/remove 时隐藏对应按钮（不假装成功）；
 * - 目录可展开（首次展开时 list 子目录），根 + 子目录里的可编辑文本文件可点击打开。
 */
import { useState, type ReactNode } from 'react';
import {
  validateWorkspaceEntryName,
  workspaceEntryName,
  workspaceEntryPath,
  workspaceParentPath,
  type WorkspaceCapabilities,
  type WorkspaceFileEntry,
} from '../../integration/workspaceProvider';
import './WorkspaceFileTree.css';

interface Props {
  /** 工作区根目录名（文件树头部只显示它）。 */
  rootName: string;
  /** 根目录条目（目录 + 可编辑文本文件，目录在前）。 */
  rootEntries: WorkspaceFileEntry[];
  /** 已展开目录的子条目：相对路径 → 条目列表。 */
  childEntries: Record<string, WorkspaceFileEntry[]>;
  /** 已展开目录的相对路径。 */
  expandedPaths: string[];
  /** 当前活动文件名。 */
  activeName: string | null;
  /** 首次 list 尚未完成。 */
  loading: boolean;
  /** 工作区同步错误（读写/刷新）。 */
  error: string | null;
  /** provider 支持的文件操作。 */
  capabilities: WorkspaceCapabilities;
  /** 打开文件。 */
  onOpen: (path: string) => void;
  /** 展开/收起目录。 */
  onToggleDir: (path: string) => void;
  /** 新建空文件（相对工作区根目录的路径）。 */
  onCreateFile: (path: string) => Promise<void>;
  /** 新建目录（相对工作区根目录的路径）。 */
  onCreateFolder: (path: string) => Promise<void>;
  /** 重命名文件或目录。 */
  onRename: (from: string, to: string, kind: 'file' | 'directory') => Promise<void>;
  /** 删除文件或目录。 */
  onRemove: (path: string, kind: 'file' | 'directory') => Promise<void>;
}

/** 正在输入的新建草稿。 */
interface CreateDraft {
  kind: 'file' | 'directory';
  value: string;
}

/** 正在重命名的目标。 */
interface RenameDraft {
  path: string;
  kind: 'file' | 'directory';
  value: string;
}

/* ── 图标（与内置文件树同风格，16px stroke） ─────────────────────────── */

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

const NewFileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <line x1="12" y1="12" x2="12" y2="18" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const NewFolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="9.5" y1="13.5" x2="14.5" y2="13.5" />
  </svg>
);

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/** 把 unknown 错误转成可展示文本。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 共享工作区文件树。 */
export function WorkspaceFileTree({
  rootName,
  rootEntries,
  childEntries,
  expandedPaths,
  activeName,
  loading,
  error,
  capabilities,
  onOpen,
  onToggleDir,
  onCreateFile,
  onCreateFolder,
  onRename,
  onRemove,
}: Props) {
  const [creating, setCreating] = useState<CreateDraft | null>(null);
  const [renaming, setRenaming] = useState<RenameDraft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 同一目录下已存在的名字（根目录或某个已展开目录）。 */
  const siblingNames = (parentPath: string): string[] =>
    (parentPath ? childEntries[parentPath] ?? [] : rootEntries).map((entry) => entry.name);

  /** 聚焦并全选 inline input。 */
  const focusInput = (input: HTMLInputElement | null): void => {
    input?.focus();
    input?.select();
  };

  /** 提交新建（根目录级）。 */
  const submitCreate = async (): Promise<void> => {
    if (!creating || busy) return;
    const name = creating.value.trim();
    const validation = validateWorkspaceEntryName(name, siblingNames(''));
    if (validation) {
      setOpError(validation);
      return;
    }
    setBusy(true);
    setOpError(null);
    try {
      if (creating.kind === 'file') await onCreateFile(name);
      else await onCreateFolder(name);
      setCreating(null);
    } catch (error) {
      setOpError((creating.kind === 'file' ? '新建文件失败：' : '新建文件夹失败：') + errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /** 提交重命名。 */
  const submitRename = async (): Promise<void> => {
    if (!renaming || busy) return;
    const parentPath = workspaceParentPath(renaming.path);
    const oldName = workspaceEntryName(renaming.path);
    const name = renaming.value.trim();
    if (name === oldName) {
      setRenaming(null);
      setOpError(null);
      return;
    }
    const validation = validateWorkspaceEntryName(name, siblingNames(parentPath), { ignore: oldName });
    if (validation) {
      setOpError(validation);
      return;
    }
    setBusy(true);
    setOpError(null);
    try {
      await onRename(renaming.path, workspaceEntryPath(parentPath, name), renaming.kind);
      setRenaming(null);
    } catch (error) {
      setOpError('重命名失败：' + errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /** 提交删除（已二次确认）。 */
  const submitRemove = async (path: string, kind: 'file' | 'directory'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOpError(null);
    try {
      await onRemove(path, kind);
      setDeleting(null);
    } catch (error) {
      setOpError('删除失败：' + errorText(error));
    } finally {
      setBusy(false);
    }
  };

  /** 渲染 inline input（新建/重命名共用）。 */
  const renderInput = (draft: CreateDraft | RenameDraft, onCommit: () => void): ReactNode => (
    <input
      className="velxio-tree-input"
      ref={focusInput}
      value={draft.value}
      placeholder={draft.kind === 'file' ? '文件名（如 sketch.ino）' : '文件夹名'}
      disabled={busy}
      onChange={(event) => {
        const value = event.target.value;
        setOpError(null);
        if (creating) setCreating({ ...creating, value });
        if (renaming) setRenaming({ ...renaming, value });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setOpError(null);
          setCreating(null);
          setRenaming(null);
        }
      }}
      onClick={(event) => event.stopPropagation()}
    />
  );

  /** 渲染一行条目的操作按钮（hover 显示）。 */
  const renderRowActions = (path: string, kind: 'file' | 'directory', name: string): ReactNode => (
    <span className="velxio-tree-actions" onClick={(event) => event.stopPropagation()}>
      {capabilities.rename ? (
        <button
          type="button"
          className="velxio-tree-icon-btn"
          title={'重命名：' + name}
          aria-label={'重命名 ' + name}
          disabled={busy}
          onClick={() => {
            setOpError(null);
            setDeleting(null);
            setRenaming({ path, kind, value: name });
          }}
        >
          <PencilIcon />
        </button>
      ) : null}
      {capabilities.remove ? (
        deleting === path && renaming?.path !== path ? (
          <>
            <button
              type="button"
              className="velxio-tree-icon-btn is-danger"
              title={'确认删除：' + name}
              aria-label={'确认删除 ' + name}
              disabled={busy}
              onClick={() => void submitRemove(path, kind)}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="velxio-tree-icon-btn"
              title="取消删除"
              aria-label="取消删除"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              <CloseIcon />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="velxio-tree-icon-btn"
            title={'删除：' + name}
            aria-label={'删除 ' + name}
            disabled={busy}
            onClick={() => {
              setOpError(null);
              setRenaming(null);
              setDeleting(path);
            }}
          >
            <TrashIcon />
          </button>
        )
      ) : null}
    </span>
  );

  /** 递归渲染目录/文件条目。 */
  const renderEntries = (entries: WorkspaceFileEntry[], parentPath: string, depth: number): ReactNode =>
    entries.map((entry) => {
      const path = workspaceEntryPath(parentPath, entry.name);
      const isDirectory = entry.type === 'directory';
      const isExpanded = isDirectory && expandedPaths.includes(path);
      const isRenaming = renaming?.path === path;
      const children = isDirectory ? childEntries[path] ?? [] : [];
      return (
        <div key={path} role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
          <div
            className={'velxio-tree-row' + (!isDirectory && activeName === path ? ' is-active' : '')}
            style={{ paddingLeft: 4 + depth * 12 }}
            title={entry.name}
            onClick={() => {
              if (isRenaming) return;
              if (isDirectory) onToggleDir(path);
              else onOpen(path);
            }}
          >
            {isDirectory ? (
              <span className={'velxio-tree-chevron' + (isExpanded ? ' is-open' : '')}>
                <ChevronIcon />
              </span>
            ) : (
              <span className="velxio-tree-spacer" />
            )}
            <span className="velxio-tree-row-icon">{isDirectory ? <FolderIcon /> : <FileIcon />}</span>
            {isRenaming ? renderInput(renaming, () => void submitRename()) : <span className="velxio-tree-name">{entry.name}</span>}
            {isRenaming ? null : renderRowActions(path, entry.type, entry.name)}
          </div>
          {isDirectory && isExpanded && children.length > 0 ? renderEntries(children, path, depth + 1) : null}
        </div>
      );
    });

  const showEmptyHint = !loading && !creating && rootEntries.length === 0 && !error && !opError;
  const newFileRow = creating ? (
    <div className="velxio-tree-row" style={{ paddingLeft: 4 }}>
      <span className="velxio-tree-spacer" />
      <span className="velxio-tree-row-icon">{creating.kind === 'file' ? <FileIcon /> : <FolderIcon />}</span>
      {renderInput(creating, () => void submitCreate())}
    </div>
  ) : null;

  return (
    <div className="file-explorer velxio-tree">
      <div className="velxio-tree-header">
        <span className="velxio-tree-root-icon">
          <FolderIcon />
        </span>
        <span className="velxio-tree-root-name" title={rootName}>
          {rootName || 'Harness 工作区'}
        </span>
        <span className="velxio-tree-header-actions" onClick={(event) => event.stopPropagation()}>
          {capabilities.createFile ? (
            <button
              type="button"
              className="velxio-tree-icon-btn"
              title="新建文件"
              aria-label="新建文件"
              disabled={busy}
              onClick={() => {
                setOpError(null);
                setRenaming(null);
                setCreating({ kind: 'file', value: '' });
              }}
            >
              <NewFileIcon />
            </button>
          ) : null}
          {capabilities.mkdir ? (
            <button
              type="button"
              className="velxio-tree-icon-btn"
              title="新建文件夹"
              aria-label="新建文件夹"
              disabled={busy}
              onClick={() => {
                setOpError(null);
                setRenaming(null);
                setCreating({ kind: 'directory', value: '' });
              }}
            >
              <NewFolderIcon />
            </button>
          ) : null}
        </span>
      </div>
      {error || opError ? <div className="velxio-tree-error">{opError ?? error}</div> : null}
      <div className="velxio-tree-list" role="tree" aria-label={rootName || '工作区文件树'}>
        {loading ? <div className="velxio-tree-hint">正在读取 Harness 工作区…</div> : null}
        {newFileRow}
        {renderEntries(rootEntries, '', 0)}
        {showEmptyHint ? (
          <div className="velxio-tree-hint">
            空工作区。{capabilities.createFile ? '点右上角图标新建文件。' : ''}
          </div>
        ) : null}
      </div>
      <div className="velxio-tree-footer">编辑自动写回真实工作区（600ms）</div>
    </div>
  );
}
