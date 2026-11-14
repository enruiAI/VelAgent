/**
 * embed 代码编辑器视图：Monaco（CodeEditor）+ 轻量文件标签栏。
 *
 * 供 Harness dock 的「代码」页签原生挂载（window.VelAgentEmbed.mountEditor）。
 * 标签栏直接读 useEditorStore 的 files / activeFileId / setActiveFile，与独立版
 * 文件树、AI 的 code_set 命令共享同一份编辑器状态；容器高度自适应（dock 可伸缩，
 * 360–900px 宽下标签横向滚动、Monaco 关 minimap 保持可读）。
 */
import { useEffect } from 'react';
import { CodeEditor } from './CodeEditor';
import { useEditorStore } from '../../store/useEditorStore';
import './EmbedEditorView.css';

export function EmbedEditorView() {
  const files = useEditorStore((s) => s.files);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0] ?? null;

  // 活动文件被删除 / 组切换后，把 activeFileId 拉回到实际展示的文件，
  // 否则标签栏没有高亮、setCode 也会写错目标。
  useEffect(() => {
    if (activeFile && activeFile.id !== activeFileId) setActiveFile(activeFile.id);
  }, [activeFile, activeFileId, setActiveFile]);

  return (
    <div className="velxio-embed-editor">
      <div className="velxio-embed-editor__tabs" role="tablist" aria-label="代码文件">
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            role="tab"
            aria-selected={file.id === activeFileId}
            title={file.name}
            className="velxio-embed-editor__tab"
            onClick={() => setActiveFile(file.id)}
          >
            <span>{file.name}</span>
            {file.modified ? <span className="velxio-embed-editor__dirty" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="velxio-embed-editor__body">
        {activeFile ? (
          <CodeEditor compact />
        ) : (
          <div className="velxio-embed-editor__empty">当前没有可编辑的代码文件</div>
        )}
      </div>
    </div>
  );
}
