/**
 * 工作台 ⇄ Harness 会话真实工作区（WorkspaceProvider）的类型与纯函数。
 *
 * 协议见 VelAgent/docs/canvas-bridge-contract.md §1：路径都是相对工作区根目录的
 * `/` 分隔路径；宿主侧由 /velagent/workspace/{list,read,write,mkdir,rename,delete}
 * 路由提供实现，dock 把 HTTP 包装成这个 provider 后传给 mountWorkspace。
 *
 * 新建/重命名/删除是可选能力：provider 没提供对应方法时工作台隐藏对应按钮，
 * 不会假装成功。
 */

/** 工作区目录里的一项。工作台展示目录 + 可编辑文本文件。 */
export interface WorkspaceFileEntry {
  /** 相对所在目录的路径（根目录一级时就是文件名）。 */
  name: string;
  type: 'file' | 'directory';
  bytes?: number;
}

/** workspace.list() 的返回值。 */
export interface WorkspaceListing {
  /** 宿主侧工作区根目录的绝对路径（只用于排查，不展示）。 */
  root: string;
  /** 根目录名，作为文件树的根节点名显示。 */
  name: string;
  entries: WorkspaceFileEntry[];
}

/** workspace.read() 的返回值；version 用于检测外部改动。 */
export interface WorkspaceReadResult {
  text: string;
  version: string;
}

/** workspace.write() 的返回值。 */
export interface WorkspaceWriteResult {
  version: string;
}

/**
 * 工作台与 Harness 会话工作区之间的文件桥。
 * list/read/write 是读写基线；mkdir/rename/remove 是可选的文件管理能力。
 */
export interface WorkspaceProvider {
  list(path?: string): Promise<WorkspaceListing>;
  read(path: string): Promise<WorkspaceReadResult>;
  write(path: string, content: string): Promise<WorkspaceWriteResult>;
  /** 新建目录（可选）；path 为相对工作区根目录的目录路径。 */
  mkdir?(path: string): Promise<void>;
  /** 重命名/移动文件或目录（可选）；from/to 都是相对工作区根目录的路径。 */
  rename?(from: string, to: string): Promise<void>;
  /** 删除文件或空目录（可选）；path 为相对工作区根目录的路径。 */
  remove?(path: string): Promise<void>;
}

/** 工作台文件树支持的文件操作（由 provider 是否实现对应方法决定）。 */
export interface WorkspaceCapabilities {
  /** 新建文件（用 write 创建空文件，所以总是可用）。 */
  createFile: boolean;
  /** 新建文件夹。 */
  mkdir: boolean;
  /** 重命名 / 移动。 */
  rename: boolean;
  /** 删除。 */
  remove: boolean;
}

/** provider 不可用时的能力集合。 */
export const NO_WORKSPACE_CAPABILITIES: WorkspaceCapabilities = {
  createFile: false,
  mkdir: false,
  rename: false,
  remove: false,
};

/**
 * 读取 provider 暴露的文件操作能力。
 * @param workspace - dock 注入的工作区 provider。
 * @returns 各操作的可用性。
 */
export function workspaceCapabilities(workspace: WorkspaceProvider | undefined): WorkspaceCapabilities {
  if (!workspace) return NO_WORKSPACE_CAPABILITIES;
  return {
    createFile: typeof workspace.write === 'function',
    mkdir: typeof workspace.mkdir === 'function',
    rename: typeof workspace.rename === 'function',
    remove: typeof workspace.remove === 'function',
  };
}

/** 工作台文件树能编辑的文本文件扩展名（小写，含点）。 */
export const WORKSPACE_EDITABLE_EXTENSIONS: readonly string[] = [
  '.ino',
  '.h',
  '.hpp',
  '.c',
  '.cpp',
  '.py',
  '.js',
  '.json',
  '.md',
  '.txt',
  '.s',
  '.asm',
];

/**
 * 判断一个路径是否是可编辑文本文件（按扩展名，大小写不敏感）。
 * @param name - 相对工作区根目录的路径。
 */
export function isEditableWorkspaceFile(name: string): boolean {
  const lower = name.toLowerCase();
  return WORKSPACE_EDITABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * 从工作区文件里挑默认打开的文件：优先第一个 .ino，否则第一个可编辑文件。
 * @param files - 已按展示顺序排好的文件列表。
 * @returns 默认文件名，列表为空时返回 null。
 */
export function pickDefaultWorkspaceFile(files: ReadonlyArray<WorkspaceFileEntry>): string | null {
  const ino = files.find((file) => file.name.toLowerCase().endsWith('.ino'));
  return ino?.name ?? files[0]?.name ?? null;
}

/**
 * 工作区文件排序：.ino 靠前，其余按名称不区分大小写。
 * @param a - 左文件。
 * @param b - 右文件。
 */
export function compareWorkspaceFiles(a: WorkspaceFileEntry, b: WorkspaceFileEntry): number {
  const aIno = a.name.toLowerCase().endsWith('.ino') ? 0 : 1;
  const bIno = b.name.toLowerCase().endsWith('.ino') ? 0 : 1;
  if (aIno !== bIno) return aIno - bIno;
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

/**
 * 目录列表归一化：保留目录 + 可编辑文本文件，目录在前、文件在后（VSCode 观感）。
 * @param entries - provider.list() 返回的条目。
 * @returns 工作台文件树要展示的条目。
 */
export function normalizeWorkspaceEntries(entries: ReadonlyArray<WorkspaceFileEntry>): WorkspaceFileEntry[] {
  const directories = entries
    .filter((entry) => entry.type === 'directory')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const files = entries
    .filter((entry) => entry.type === 'file' && isEditableWorkspaceFile(entry.name))
    .map((entry) => ({ name: entry.name, type: 'file' as const, ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }) }))
    .sort(compareWorkspaceFiles);
  return [...directories, ...files];
}

/**
 * 拼接相对路径。
 * @param parentPath - 父目录相对路径；根目录为空串。
 * @param name - 子项名称。
 * @returns 相对工作区根目录的路径。
 */
export function workspaceEntryPath(parentPath: string, name: string): string {
  return parentPath ? parentPath + '/' + name : name;
}

/**
 * 取相对路径的父目录。
 * @param path - 相对工作区根目录的路径。
 * @returns 父目录相对路径；根目录一级返回空串。
 */
export function workspaceParentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/** 文件名（路径最后一段）。 */
export function workspaceEntryName(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

const INVALID_WORKSPACE_NAME_CHARS = /[\\/:*?"<>|]/;

/**
 * 校验用户输入的文件/文件夹名。
 * @param name - 输入框里的名字（首尾空白会被去掉）。
 * @param siblingNames - 同目录下已存在的名字。
 * @param options.ignore - 重命名时忽略的旧名字（允许只改大小写以外的不变名）。
 * @returns 错误文案；合法时返回 null。
 */
export function validateWorkspaceEntryName(
  name: string,
  siblingNames: ReadonlyArray<string>,
  options: { ignore?: string } = {},
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '名称不能为空';
  if (trimmed === '.' || trimmed === '..') return '名称不能是 . 或 ..';
  if (trimmed.length > 128) return '名称太长（最多 128 个字符）';
  if (INVALID_WORKSPACE_NAME_CHARS.test(trimmed)) return '名称不能包含 \\ / : * ? " < > |';
  if (trimmed !== options.ignore && siblingNames.includes(trimmed)) return '同名文件或文件夹已存在';
  return null;
}
