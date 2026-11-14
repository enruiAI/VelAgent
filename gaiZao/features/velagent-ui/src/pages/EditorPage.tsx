/**
 * EditorPage — 纯前端版主界面：左侧代码编辑器 + 文件树，右侧电路画布。
 *
 * 与上游相比删掉了：编译控制台、串口监视器、示波器、电气仿真面板、
 * 编译/运行/烧录按钮、账号区、自动保存与分享。现在只有编辑 + 画布。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeEditor } from '../components/editor/CodeEditor';
import { FileExplorer } from '../components/editor/FileExplorer';
import { WorkspaceFileTree } from '../components/editor/WorkspaceFileTree';
import { EditorMenuBar } from '../components/editor/EditorMenuBar';
import { CircuitJsonPanel } from '../components/editor/CircuitJsonPanel';
import { SimulatorCanvas } from '../components/simulator/SimulatorCanvas';
import { AppHeader } from '../components/layout/AppHeader';
import { AiControlPanel } from '../components/AiControlPanel';
import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { ActivityRail } from '../components/layout/ActivityRail';
import { StatusBar } from '../components/layout/StatusBar';
import { AiStatusPill } from '../components/layout/AiStatusPill';
import { openHarnessWindow } from '../integration/harnessWeb';
import { AiSettingsModal } from '../components/AiSettingsModal';
import { RunPreviewPanel } from '../components/RunPreviewPanel';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { getPlaybook, playPlaybook, resetLeds, type Playbook } from '../integration/preview';
import { useEditorStore } from '../store/useEditorStore';
import { showMessageDialog } from '../store/useMessageDialogStore';
import { registerEditorCommand } from '../lib/editorCommands';
import { triggerDownloadVlx } from '../utils/vlxFile';
import { useSharedWorkspace } from '../hooks/useSharedWorkspace';
import type { WorkspaceProvider } from '../integration/workspaceProvider';
import '../App.css';

const btnStyle: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  border: '1px solid var(--wb-7)',
  background: 'transparent',
  color: 'var(--wb-11)',
  borderRadius: 4,
};

/** mountWorkspace 渲染本页面时传入的选项（见 src/embed.tsx v3）。 */
export interface EditorPageProps {
  /**
   * 嵌入 Harness dock：隐藏依赖 Tauri 桌面控制面的「AI 助手 / AI 控制台 /
   * AI 设置」入口与面板，整页高度跟随父容器；品牌头、视图切换、文件树、
   * AI 运行、GitHub、使用说明、导出、底部状态栏保持独立版原样。
   */
  embedded?: boolean;
  /**
   * 嵌入模式下的「AI 运行」回调：由 Harness 插件注入，把试运行请求交给
   * Harness 的模型（模型再调用 velagent_* 工具驱动画布）。省略时保持现有
   * 本地规则预测兜底，不会报错。
   */
  onAiRun?: () => void;
  /**
   * Harness 会话真实工作区。提供后（embedded 时）左侧文件树改为真实工作区：
   * list 展示、read 载入、编辑 debounce 600ms 写回、每 2s/focus 刷新外部改动；
   * 省略时保持独立版内置文件树行为。
   */
  workspace?: WorkspaceProvider;
}

export const EditorPage: React.FC<EditorPageProps> = ({ embedded = false, onAiRun, workspace }) => {
  const { t, i18n } = useTranslation();
  const zh = String(i18n.language || 'zh').toLowerCase().startsWith('zh');
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const explorerOpen = useEditorStore((s) => s.explorerOpen);
  const toggleExplorer = useEditorStore((s) => s.toggleExplorer);

  const [editorWidthPct, setEditorWidthPct] = useState(45);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [serialLines, setSerialLines] = useState<string[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const stopRef = useRef<null | (() => void)>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  // 嵌入 Harness 且 dock 注入了真实工作区时，文件树换成会话工作区（同一目录）。
  // 未提供 provider 时 hook 是空操作，独立版行为不变。
  const sharedWorkspace = useSharedWorkspace(embedded ? workspace : undefined);
  const sharedWorkspaceMode = embedded && workspace !== undefined;

  // 纯前端导出：把整个工作区保存成 .vlx（JSON）文件，不需要服务器。
  const handleSave = useCallback(() => {
    try {
      triggerDownloadVlx({ name: 'velxio-project' });
    } catch (err) {
      showMessageDialog({ title: '导出失败', message: String(err) });
    }
  }, []);

  const handleNew = useCallback(() => {
    showMessageDialog({
      title: '新建工作区',
      message: '精简版里新建工作区请在画布上直接添加元件；如需清空，可刷新页面（Ctrl+R）。',
    });
  }, []);

  // 菜单/快捷键命令：导出、新建提示。
  useEffect(() => {
    const offExport = registerEditorCommand('project.exportVlx', handleSave);
    const offNew = registerEditorCommand('project.new', handleNew);
    return () => {
      offExport();
      offNew();
    };
  }, [handleSave, handleNew]);


  const stopRun = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    resetLeds();
    setRunBusy(false);
  }, []);

  const handleRun = useCallback(async () => {
    // 嵌入 Harness：交给宿主把「试运行」prompt 发给 Harness 模型（模型再调用
    // velagent_* 工具读画布/代码并播放时间轴）；没有注入回调时继续走本地规则兜底。
    if (embedded && onAiRun) {
      try {
        onAiRun();
      } catch (error) {
        console.warn('[velagent] 工作台 AI 运行回调失败', error);
      }
      return;
    }
    if (runBusy) {
      stopRun();
      return;
    }
    const ed = useEditorStore.getState();
    const file = ed.files.find((f) => f.id === ed.activeFileId) ?? ed.files[0];
    if (!file) {
      showMessageDialog({ title: '没有可运行的文件', message: '请先在左侧新建或打开一个代码文件。' });
      return;
    }
    const language = file.name.endsWith('.py') ? 'micropython' : 'arduino';
    const boardKind = useSimulatorStore.getState().boards[0]?.boardKind;
    setSerialLines([]);
    setPlaybook(null);
    setRunBusy(true);
    try {
      const pb = await getPlaybook({ code: file.content, language, boardKind });
      setPlaybook(pb);
      const stop = playPlaybook(pb, {
        onEvent: (event) => {
          if (event.leds) {
            const sim = useSimulatorStore.getState();
            for (const [id, on] of Object.entries(event.leds)) sim.updateComponentState(id, on);
          }
          if (event.serial) setSerialLines((prev) => [...prev, event.serial as string]);
        },
        onDone: () => setRunBusy(false),
      });
      stopRef.current = stop;
    } catch (err) {
      setRunBusy(false);
      showMessageDialog({ title: '运行预测失败', message: String(err) });
    }
  }, [embedded, onAiRun, runBusy, stopRun]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) return;
      const el = containerRef.current;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const padLeft = parseFloat(cs.paddingLeft) || 0;
      const padRight = parseFloat(cs.paddingRight) || 0;
      const contentLeft = rect.left + el.clientLeft + padLeft;
      const contentWidth = el.clientWidth - padLeft - padRight;
      if (contentWidth <= 0) return;
      const pct = ((ev.clientX - contentLeft) / contentWidth) * 100;
      setEditorWidthPct(Math.max(20, Math.min(80, pct)));
    };
    const handleMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    ...btnStyle,
    background: active ? 'var(--color-action-primary)' : 'transparent',
    color: active ? 'white' : 'var(--wb-11)',
    borderColor: active ? 'transparent' : 'var(--wb-7)',
  });

  const editorPanelWidth =
    viewMode === 'code' || viewMode === 'json'
      ? '100%'
      : viewMode === 'circuit'
        ? '0%'
        : `${editorWidthPct}%`;

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <span style={{ flex: 1 }} />
      <div className="va-viewswitch" role="group" aria-label="切换视图">
        {([
          ['code', '代码'],
          ['both', '分栏'],
          ['circuit', '电路'],
          ['json', 'JSON'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setViewMode(key)}
            aria-pressed={viewMode === key}
          >
            {label}
          </button>
        ))}
      </div>
      {!embedded && <AiStatusPill onClick={() => setAiPanelOpen((v) => !v)} />}
      <button
        type="button"
        className="va-action va-action--primary"
        onClick={() => void handleRun()}
        title="让 AI 预测这段代码的运行效果"
      >
        {runBusy ? '■ 停止' : '▶ AI 运行'}
      </button>
      <button type="button" className="va-action" onClick={handleSave} title="导出 .vlx 项目文件">
        导出 .vlx
      </button>
    </div>
  );

  return (
    <div
      className="app"
      style={{
        display: 'flex',
        flexDirection: 'column',
        // 独立版铺满视口；嵌入 dock 时跟随 Harness 给的面板高度。
        height: embedded ? '100%' : '100vh',
        width: '100%',
        minHeight: 0,
        background: embedded ? 'var(--color-bg-canvas)' : undefined,
      }}
    >
      <AppHeader editorMenu={<EditorMenuBar />} editorToolbar={toolbar} brandLink={!embedded} />

      <div className="va-body">
        <ActivityRail
          explorerOpen={explorerOpen}
          onToggleExplorer={toggleExplorer}
          onOpenAiConsole={() => setAiPanelOpen(true)}
          onOpenAiSettings={() => setAiSettingsOpen(true)}
          onRun={() => void handleRun()}
          runBusy={runBusy}
          aiConsoleOpen={aiPanelOpen}
          aiSettingsOpen={aiSettingsOpen}
          onOpenAssistant={() => {
            setAiAssistantOpen(true);
            setAiPanelOpen(false);
          }}
          aiAssistantOpen={aiAssistantOpen}
          onOpenHarness={() => {
            void openHarnessWindow().catch((error) => {
              showMessageDialog({
                title: 'Harness 界面启动失败',
                message:
                  '内嵌 DeepSeek Harness 需要先构建官方前端资源：\n\n' +
                  'cd deepseek-harness\npnpm install\npnpm build:artifacts\n\n' +
                  '然后重启应用。\n\n错误：' +
                  String(error),
              });
            });
          }}
          embedded={embedded}
        />

      <div
        className="app-container"
        ref={containerRef}
        style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}
      >
        {/* ── 左侧：文件树 + Monaco 编辑器 ── */}
        <div
          className="editor-panel"
          style={{
            width: editorPanelWidth,
            display: viewMode === 'circuit' ? 'none' : 'flex',
            flexDirection: 'row',
            minWidth: 0,
          }}
        >
          {explorerOpen && (
            <div
              style={{
                width: 220,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderRight: '1px solid var(--wb-7)',
              }}
            >
              {sharedWorkspaceMode ? (
                <WorkspaceFileTree
                  rootName={sharedWorkspace.rootName}
                  rootEntries={sharedWorkspace.rootEntries}
                  childEntries={sharedWorkspace.childEntries}
                  expandedPaths={sharedWorkspace.expandedPaths}
                  activeName={sharedWorkspace.activeName}
                  loading={sharedWorkspace.loading}
                  error={sharedWorkspace.error}
                  capabilities={sharedWorkspace.capabilities}
                  onOpen={sharedWorkspace.openFile}
                  onToggleDir={sharedWorkspace.toggleDir}
                  onCreateFile={sharedWorkspace.createFile}
                  onCreateFolder={sharedWorkspace.createFolder}
                  onRename={sharedWorkspace.renameEntry}
                  onRemove={sharedWorkspace.removeEntry}
                />
              ) : (
                <FileExplorer onSaveClick={handleSave} onNewClick={handleNew} />
              )}
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
            {viewMode === 'json' ? (
              <CircuitJsonPanel />
            ) : (
              <div className="editor-wrapper" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <CodeEditor />
              </div>
            )}
          </div>
        </div>

        {/* ── 分栏拖拽条 ── */}
        {viewMode === 'both' && (
          <div className="resize-handle" onMouseDown={handleResizeMouseDown}>
            <div className="resize-handle-grip" />
          </div>
        )}

        {/* ── 右侧：电路画布 ── */}
        <div
          className="simulator-panel"
          style={{
            width:
              viewMode === 'circuit'
                ? '100%'
                : viewMode === 'code' || viewMode === 'json'
                  ? '0%'
                  : `${100 - editorWidthPct}%`,
            display: viewMode === 'code' || viewMode === 'json' ? 'none' : 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <SimulatorCanvas />
        </div>
      </div>
        {!embedded && (
          <>
            <AiAssistantPanel
              open={aiAssistantOpen}
              onClose={() => setAiAssistantOpen(false)}
              onOpenSettings={() => setAiSettingsOpen(true)}
            />
            <AiControlPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />
          </>
        )}
      </div>

      <StatusBar
        embedded={embedded}
        onOpenAiConsole={() => {
          setAiAssistantOpen(false);
          setAiPanelOpen(true);
        }}
      />
      {!embedded && <AiSettingsModal open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />}
      <RunPreviewPanel
        playbook={playbook}
        serial={serialLines}
        running={runBusy}
        onStop={stopRun}
        onClose={() => {
          stopRun();
          setPlaybook(null);
        }}
      />
    </div>
  );
};
