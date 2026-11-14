/**
 * 共享工作区同步：把 Harness 会话的真实工作区（WorkspaceProvider）接到工作台的
 * Monaco / 标签栏（useEditorStore）与文件树上。
 *
 * - list：展示真实工作区目录（目录可展开，文件按可编辑扩展名过滤）；
 * - read：打开文件时把内容灌进 editor store；
 * - write：编辑器改动 debounce 600ms 写回真实文件；
 * - 每 2s / 窗口 focus 重新 list，并用 read 的 version 检测已打开文件的外部改动，
 *   本地无未保存改动时自动重载（Harness Agent 改文件后工作台能看到）；
 * - 文件管理：新建文件（write 空文件）、新建文件夹（mkdir）、重命名（rename）、
 *   删除（remove）——provider 没提供的方法对应按钮会隐藏。
 *
 * 未提供 provider 时（独立版 / 无工作区 dock）不做任何事，保持原内置文件树行为。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import {
  NO_WORKSPACE_CAPABILITIES,
  isEditableWorkspaceFile,
  normalizeWorkspaceEntries,
  pickDefaultWorkspaceFile,
  workspaceCapabilities,
  type WorkspaceCapabilities,
  type WorkspaceFileEntry,
  type WorkspaceProvider,
} from '../integration/workspaceProvider';

/** 编辑器改动写回真实文件的去抖窗口。 */
export const WORKSPACE_WRITE_DEBOUNCE_MS = 600;
/** 外部改动轮询间隔（窗口 focus 时也会立即刷新）。 */
export const WORKSPACE_REFRESH_INTERVAL_MS = 2000;

/** useSharedWorkspace 暴露给工作台 UI 的状态与操作。 */
export interface SharedWorkspaceState {
  /** 工作区根目录名（文件树头部只显示它）。 */
  rootName: string;
  /** 根目录条目：目录 + 可编辑文本文件（目录在前）。 */
  rootEntries: WorkspaceFileEntry[];
  /** 已展开目录的子条目：相对路径 → 条目列表。 */
  childEntries: Record<string, WorkspaceFileEntry[]>;
  /** 已展开目录的相对路径。 */
  expandedPaths: string[];
  /** 当前活动文件名；没有打开文件时为 null。 */
  activeName: string | null;
  /** 首次 list 尚未完成。 */
  loading: boolean;
  /** 最近一次同步错误（只提示，不打断编辑）。 */
  error: string | null;
  /** provider 支持的文件操作（新建文件/新建文件夹/重命名/删除）。 */
  capabilities: WorkspaceCapabilities;
  /** 打开/切换文件；首次打开会通过 provider.read 读入内容。 */
  openFile: (name: string) => void;
  /** 展开/收起目录（首次展开时 list 该目录）。 */
  toggleDir: (path: string) => void;
  /** 立即刷新文件列表（外部改动检测）。 */
  refresh: () => void;
  /** 新建空文件并打开（path 为相对工作区根目录的完整路径）。 */
  createFile: (path: string) => Promise<void>;
  /** 新建目录（path 为相对工作区根目录的完整路径）。 */
  createFolder: (path: string) => Promise<void>;
  /** 重命名文件或目录（from/to 都是相对工作区根目录的路径）。 */
  renameEntry: (from: string, to: string, kind: 'file' | 'directory') => Promise<void>;
  /** 删除文件或空目录（path 为相对工作区根目录的路径）。 */
  removeEntry: (path: string, kind: 'file' | 'directory') => Promise<void>;
}

/** 已从 provider 读入/写出的内容基线，用于区分“本地改动”和“外部改动”。 */
interface FileBaseline {
  content: string;
  version: string;
}

/** 文件树操作集合（effect 内创建，通过 ref 暴露给稳定回调）。 */
interface WorkspaceActions {
  openFile: (name: string) => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  createFile: (path: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  renameEntry: (from: string, to: string, kind: 'file' | 'directory') => Promise<void>;
  removeEntry: (path: string, kind: 'file' | 'directory') => Promise<void>;
}

const NOOP = (): void => {};
const REJECT_NO_WORKSPACE = (): Promise<never> => Promise.reject(new Error('未连接 Harness 工作区'));

/** 未提供 provider 时返回的空状态。 */
const EMPTY_STATE: Omit<SharedWorkspaceState, 'openFile' | 'toggleDir' | 'refresh' | 'createFile' | 'createFolder' | 'renameEntry' | 'removeEntry'> = {
  rootName: '',
  rootEntries: [],
  childEntries: {},
  expandedPaths: [],
  activeName: null,
  loading: false,
  error: null,
  capabilities: NO_WORKSPACE_CAPABILITIES,
};

/**
 * 把工作台编辑器接到共享工作区上。
 * @param workspace - dock 注入的真实工作区 provider；undefined 时保持原独立版行为。
 * @returns 文件树状态与打开/刷新/文件管理操作。
 */
export function useSharedWorkspace(workspace: WorkspaceProvider | undefined): SharedWorkspaceState {
  const [rootName, setRootName] = useState('');
  const [rootEntries, setRootEntries] = useState<WorkspaceFileEntry[]>([]);
  const [childEntries, setChildEntries] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [loading, setLoading] = useState(workspace !== undefined);
  const [error, setError] = useState<string | null>(null);

  /** 当前 provider（避免 effect 里拿到旧的闭包）。 */
  const workspaceRef = useRef<WorkspaceProvider | undefined>(workspace);
  workspaceRef.current = workspace;
  /** 已从 provider 读入/写出的内容基线。 */
  const baselineRef = useRef(new Map<string, FileBaseline>());
  /** 待写回的真实文件内容（debounce 批量 flush）。 */
  const pendingWritesRef = useRef(new Map<string, string>());
  const writeTimerRef = useRef<number | undefined>(undefined);
  const flushingRef = useRef(false);
  /** 已展开目录（ref 供 refresh 使用）与它们的子条目缓存。 */
  const expandedRef = useRef<string[]>([]);
  const childrenRef = useRef<Record<string, WorkspaceFileEntry[]>>({});
  const refreshingRef = useRef(false);
  /** 已经打开过（读过）的文件，外部改动检测只关注这些。 */
  const openedRef = useRef(new Set<string>());
  /** 正在从 provider 读入的文件：写回监听要跳过，避免把“空标签”写回磁盘。 */
  const loadingFilesRef = useRef(new Set<string>());
  /** 文件树操作（effect 内赋值）。 */
  const actionsRef = useRef<WorkspaceActions>({
    openFile: async () => {},
    toggleDir: async () => {},
    refresh: async () => {},
    createFile: async () => {},
    createFolder: async () => {},
    renameEntry: async () => {},
    removeEntry: async () => {},
  });

  useEffect(() => {
    const provider = workspace;
    if (!provider) {
      setLoading(false);
      return;
    }
    let disposed = false;

    // 新 provider：清掉上一份工作区状态与内置虚拟文件，避免和真实文件混淆。
    baselineRef.current.clear();
    pendingWritesRef.current.clear();
    openedRef.current.clear();
    loadingFilesRef.current.clear();
    expandedRef.current = [];
    childrenRef.current = {};
    setExpandedPaths([]);
    setChildEntries({});
    setRootEntries([]);
    setRootName('');
    useEditorStore.getState().loadFiles([]);

    /** 把一个真实文件读进 editor store（不存在对应标签时先建一个）。 */
    const loadFile = async (name: string): Promise<void> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider || disposed) return;
      const store = useEditorStore.getState();
      let file = store.files.find((candidate) => candidate.name === name);
      if (!file) {
        store.createFile(name);
        file = useEditorStore.getState().files.find((candidate) => candidate.name === name);
      }
      if (!file) return;
      store.setActiveFile(file.id);
      loadingFilesRef.current.add(name);
      try {
        const result = await currentProvider.read(name);
        if (disposed) return;
        baselineRef.current.set(name, { content: result.text, version: result.version });
        openedRef.current.add(name);
        // createFile 产生的空内容可能已排队写回，读入成功后取消它。
        pendingWritesRef.current.delete(name);
        loadingFilesRef.current.delete(name);
        const target = useEditorStore.getState();
        target.setFileContent(file.id, result.text);
        target.markFileSaved(file.id);
        setActiveName(name);
        setError(null);
      } catch (err) {
        loadingFilesRef.current.delete(name);
        if (!disposed) setError('读取工作区文件失败：' + errorText(err));
      }
    };

    /** list 一个目录并归一化（目录在前、文件按扩展名过滤）。 */
    const listDir = async (path?: string): Promise<{ name: string; entries: WorkspaceFileEntry[] }> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider) return { name: '', entries: [] };
      const listing = await currentProvider.list(path);
      return { name: listing.name, entries: normalizeWorkspaceEntries(listing.entries) };
    };

    /** 刷新根目录 + 所有展开目录，并重载外部改动过的已打开文件。 */
    const refresh = async (): Promise<void> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider || disposed || refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const listing = await currentProvider.list();
        if (disposed) return;
        setRootEntries(normalizeWorkspaceEntries(listing.entries));
        setRootName(listing.name);
        setLoading(false);
        // 展开中的目录也刷新一下（Agent 可能在子目录里新建文件）。
        const stillExpanded: string[] = [];
        for (const dirPath of [...expandedRef.current]) {
          try {
            const dirListing = await listDir(dirPath);
            if (disposed) return;
            childrenRef.current = { ...childrenRef.current, [dirPath]: dirListing.entries };
            stillExpanded.push(dirPath);
          } catch {
            // 目录可能被外部删掉/改名：收起它。
            delete childrenRef.current[dirPath];
          }
        }
        expandedRef.current = stillExpanded;
        setExpandedPaths([...stillExpanded]);
        setChildEntries({ ...childrenRef.current });
        // 已打开文件的外部改动（version 变化且本地无未保存改动 → 重载）。
        for (const name of [...openedRef.current]) {
          const baseline = baselineRef.current.get(name);
          if (!baseline) continue;
          const store = useEditorStore.getState();
          const file = store.files.find((candidate) => candidate.name === name);
          if (!file || file.content !== baseline.content) continue; // 本地有改动，交给写回
          let result;
          try {
            result = await currentProvider.read(name);
          } catch {
            continue; // 文件可能被外部删除/改名：保留标签，不打断刷新
          }
          if (disposed) return;
          if (result.version === baseline.version && result.text === baseline.content) continue;
          const latest = useEditorStore.getState().files.find((candidate) => candidate.name === name);
          if (!latest || latest.content !== baseline.content) continue;
          baselineRef.current.set(name, { content: result.text, version: result.version });
          useEditorStore.getState().setFileContent(file.id, result.text);
          useEditorStore.getState().markFileSaved(file.id);
        }
        setError(null);
      } catch (err) {
        if (!disposed) setError('刷新工作区文件失败：' + errorText(err));
      } finally {
        refreshingRef.current = false;
      }
    };

    /** 在根目录挑默认文件并打开（优先第一个 .ino）。 */
    const openDefaultFile = async (): Promise<void> => {
      try {
        const rootListing = await listDir();
        const preferred = pickDefaultWorkspaceFile(rootListing.entries.filter((entry) => entry.type === 'file'));
        if (preferred) await loadFile(preferred);
      } catch {
        /* 首次打开失败由 refresh/错误状态兜底 */
      }
    };

    /** 把 pending 的本地改动逐个写回真实文件。 */
    const flushWrites = async (): Promise<void> => {
      if (flushingRef.current) return;
      flushingRef.current = true;
      try {
        while (!disposed && pendingWritesRef.current.size > 0) {
          const iterator = pendingWritesRef.current.entries().next();
          if (iterator.done) break;
          const [name, content] = iterator.value;
          pendingWritesRef.current.delete(name);
          const currentProvider = workspaceRef.current;
          if (!currentProvider) break;
          try {
            const result = await currentProvider.write(name, content);
            if (disposed) return;
            const file = useEditorStore.getState().files.find((candidate) => candidate.name === name);
            if (file && file.content === content) {
              baselineRef.current.set(name, { content, version: result.version });
              useEditorStore.getState().markFileSaved(file.id);
              setError(null);
            } else if (file) {
              // 写回期间用户又改了内容：把最新内容重新排队。
              pendingWritesRef.current.set(name, file.content);
            }
          } catch (err) {
            if (!disposed) setError('写回工作区文件失败：' + errorText(err));
          }
        }
      } finally {
        flushingRef.current = false;
      }
    };

    /** 600ms 去抖后再写回。 */
    const scheduleFlush = (): void => {
      if (disposed) return;
      if (writeTimerRef.current !== undefined) window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = window.setTimeout(() => {
        writeTimerRef.current = undefined;
        void flushWrites();
      }, WORKSPACE_WRITE_DEBOUNCE_MS);
    };

    /** 跟踪 editor store：本地改动排队写回；标签切换同步 activeName。 */
    const onEditorStateChange = (): void => {
      const store = useEditorStore.getState();
      const active = store.files.find((candidate) => candidate.id === store.activeFileId);
      setActiveName(active?.name ?? null);
      let changed = false;
      for (const file of store.files) {
        if (loadingFilesRef.current.has(file.name)) continue;
        const baseline = baselineRef.current.get(file.name);
        if (baseline !== undefined && file.content === baseline.content) continue;
        pendingWritesRef.current.set(file.name, file.content);
        changed = true;
      }
      if (changed) scheduleFlush();
    };

    /** 打开/切换文件。 */
    const openFile = async (name: string): Promise<void> => {
      const store = useEditorStore.getState();
      const existing = store.files.find((candidate) => candidate.name === name);
      if (existing) {
        store.setActiveFile(existing.id);
        return;
      }
      await loadFile(name);
    };

    /** 展开/收起目录。 */
    const toggleDir = async (path: string): Promise<void> => {
      if (expandedRef.current.includes(path)) {
        expandedRef.current = expandedRef.current.filter((candidate) => candidate !== path);
        setExpandedPaths([...expandedRef.current]);
        return;
      }
      expandedRef.current = [...expandedRef.current, path];
      setExpandedPaths([...expandedRef.current]);
      try {
        const listing = await listDir(path);
        if (disposed) return;
        childrenRef.current = { ...childrenRef.current, [path]: listing.entries };
        setChildEntries({ ...childrenRef.current });
      } catch (err) {
        if (!disposed) setError('读取工作区目录失败：' + errorText(err));
      }
    };

    /** 关闭 path 自身或它下面的所有标签（重命名/删除后调用）。 */
    const closeTabsUnder = (path: string): void => {
      const store = useEditorStore.getState();
      for (const file of [...store.files]) {
        if (file.name !== path && !file.name.startsWith(path + '/')) continue;
        baselineRef.current.delete(file.name);
        pendingWritesRef.current.delete(file.name);
        openedRef.current.delete(file.name);
        store.deleteFile(file.id);
      }
    };

    /** 清掉 path 自身或它下面的展开状态缓存。 */
    const forgetTreeStateUnder = (path: string): void => {
      const matches = (candidate: string): boolean => candidate === path || candidate.startsWith(path + '/');
      expandedRef.current = expandedRef.current.filter((candidate) => !matches(candidate));
      for (const key of Object.keys(childrenRef.current)) {
        if (matches(key)) delete childrenRef.current[key];
      }
      setExpandedPaths([...expandedRef.current]);
      setChildEntries({ ...childrenRef.current });
    };

    /** 新建空文件（provider 用 write 创建）并打开它。 */
    const createFile = async (path: string): Promise<void> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider) throw new Error('未连接 Harness 工作区');
      await currentProvider.write(path, '');
      await refresh();
      if (disposed) return;
      await loadFile(path);
    };

    /** 新建目录。 */
    const createFolder = async (path: string): Promise<void> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider?.mkdir) throw new Error('当前工作区不支持新建文件夹');
      await currentProvider.mkdir(path);
      await refresh();
    };

    /** 重命名文件/目录；文件重命名后自动打开新名字。 */
    const renameEntry = async (from: string, to: string, kind: 'file' | 'directory'): Promise<void> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider?.rename) throw new Error('当前工作区不支持重命名');
      await currentProvider.rename(from, to);
      closeTabsUnder(from);
      forgetTreeStateUnder(from);
      await refresh();
      if (disposed) return;
      if (kind === 'file' && isEditableWorkspaceFile(to)) await loadFile(to);
    };

    /** 删除文件或空目录。 */
    const removeEntry = async (path: string, _kind: 'file' | 'directory'): Promise<void> => {
      const currentProvider = workspaceRef.current;
      if (!currentProvider?.remove) throw new Error('当前工作区不支持删除');
      await currentProvider.remove(path);
      closeTabsUnder(path);
      forgetTreeStateUnder(path);
      await refresh();
    };

    actionsRef.current = { openFile, toggleDir, refresh, createFile, createFolder, renameEntry, removeEntry };

    const unsubscribe = useEditorStore.subscribe(onEditorStateChange);
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      void refresh();
    }, WORKSPACE_REFRESH_INTERVAL_MS);

    void (async () => {
      try {
        const listing = await provider.list();
        if (disposed) return;
        setRootEntries(normalizeWorkspaceEntries(listing.entries));
        setRootName(listing.name);
        setLoading(false);
        await openDefaultFile();
        void refresh();
      } catch (err) {
        if (!disposed) {
          setLoading(false);
          setError('读取 Harness 工作区失败：' + errorText(err));
        }
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
      if (writeTimerRef.current !== undefined) {
        window.clearTimeout(writeTimerRef.current);
        writeTimerRef.current = undefined;
      }
      actionsRef.current = {
        openFile: async () => {},
        toggleDir: async () => {},
        refresh: async () => {},
        createFile: async () => {},
        createFolder: async () => {},
        renameEntry: async () => {},
        removeEntry: async () => {},
      };
    };
  }, [workspace]);

  const openFile = useCallback((name: string): void => {
    void actionsRef.current.openFile(name);
  }, []);
  const toggleDir = useCallback((path: string): void => {
    void actionsRef.current.toggleDir(path);
  }, []);
  const refresh = useCallback((): void => {
    void actionsRef.current.refresh();
  }, []);
  const createFile = useCallback((path: string): Promise<void> => actionsRef.current.createFile(path), []);
  const createFolder = useCallback((path: string): Promise<void> => actionsRef.current.createFolder(path), []);
  const renameEntry = useCallback(
    (from: string, to: string, kind: 'file' | 'directory'): Promise<void> => actionsRef.current.renameEntry(from, to, kind),
    [],
  );
  const removeEntry = useCallback(
    (path: string, kind: 'file' | 'directory'): Promise<void> => actionsRef.current.removeEntry(path, kind),
    [],
  );

  const capabilities = workspaceCapabilities(workspace);
  if (workspace === undefined) {
    return {
      ...EMPTY_STATE,
      openFile: NOOP,
      toggleDir: NOOP,
      refresh: NOOP,
      createFile: REJECT_NO_WORKSPACE,
      createFolder: REJECT_NO_WORKSPACE,
      renameEntry: REJECT_NO_WORKSPACE,
      removeEntry: REJECT_NO_WORKSPACE,
    };
  }

  return {
    rootName,
    rootEntries,
    childEntries,
    expandedPaths,
    activeName,
    loading,
    error,
    capabilities,
    openFile,
    toggleDir,
    refresh,
    createFile,
    createFolder,
    renameEntry,
    removeEntry,
  };
}

/** 把 unknown 错误转成可展示文本。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
