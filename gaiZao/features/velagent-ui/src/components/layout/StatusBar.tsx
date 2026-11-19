import React, { useEffect, useState } from 'react';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { useEditorStore } from '../../store/useEditorStore';
import { getControlInfo, isDesktop } from '../../integration/controlBridge';

interface Props {
  onOpenAiConsole: () => void;
  /**
   * 嵌入 Harness dock：不再显示/打开依赖 Tauri 本地控制面的「AI 控制台」入口，
   * 左侧换成静态的「VelAgent 工作台」标识；画布统计、视图、版本照旧保留。
   */
  embedded?: boolean;
}

/** 底部状态栏：AI 控制面（或嵌入模式标识） / 画布统计 / 版本与许可。 */
export const StatusBar: React.FC<Props> = ({ onOpenAiConsole, embedded = false }) => {
  const boards = useSimulatorStore((s) => s.boards);
  const components = useSimulatorStore((s) => s.components);
  const wires = useSimulatorStore((s) => s.wires);
  const viewMode = useEditorStore((s) => s.viewMode);
  const [port, setPort] = useState<number | null>(null);
  const [writable, setWritable] = useState(false);
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const load = async () => {
      const info = await getControlInfo();
      if (!alive || !info) return;
      setPort(info.port);
      setWritable(info.aiCanWrite);
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [desktop]);

  const viewLabel = viewMode === 'code' ? '代码' : viewMode === 'both' ? '分栏' : '电路';

  return (
    <footer className="va-statusbar">
      {embedded ? (
        <span className="va-statusbar-item" title="VelAgent 工作台（嵌入 DeepSeek Harness）">
          <span className="va-dot" style={{ width: 6, height: 6 }} />
          <strong>VelAgent 工作台</strong>
        </span>
      ) : (
        <button
          type="button"
          className="va-statusbar-item"
          onClick={onOpenAiConsole}
          title="打开 AI 控制台"
          style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          <span className={'va-dot' + (desktop ? (writable ? '' : ' va-dot--readonly') : ' va-dot--offline')} style={{ width: 6, height: 6 }} />
          <strong>{desktop ? 'AI 控制面' : '浏览器预览'}</strong>
          {desktop && port ? <span>127.0.0.1:{port}</span> : null}
          {desktop && <span style={{ color: writable ? 'var(--va-accent-2)' : '#ffb020' }}>{writable ? '可写' : '只读'}</span>}
        </button>
      )}
      <span className="va-statusbar-sep" />
      <span className="va-statusbar-item"><strong>{boards.length}</strong> 板卡</span>
      <span className="va-statusbar-item"><strong>{components.length}</strong> 元件</span>
      <span className="va-statusbar-item"><strong>{wires.length}</strong> 连线</span>
      <span className="va-statusbar-sep" />
      <span className="va-statusbar-item">视图：<strong>{viewLabel}</strong></span>
      <span className="va-statusbar-right">
        <span className="va-statusbar-item">VelAgent v0.1.0</span>
        <span className="va-statusbar-item va-credit">AGPLv3 · 基于 Velxio</span>
      </span>
    </footer>
  );
};
