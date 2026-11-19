import React from 'react';
import { openExternal } from '../../integration/openExternal';

interface Props {
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  onOpenAiConsole: () => void;
  onOpenAiSettings: () => void;
  onRun: () => void;
  runBusy: boolean;
  aiConsoleOpen: boolean;
  aiSettingsOpen: boolean;
  onOpenAssistant: () => void;
  aiAssistantOpen: boolean;
  onOpenHarness: () => void;
  /**
   * 嵌入 Harness dock 时隐藏依赖 Tauri 桌面控制面的入口（AI 助手 / Harness 官方界面 /
   * AI 控制台 / AI 设置）：它们只有在桌面端才有意义，嵌进 Harness 后是空壳且重复。
   * 保留文件树、AI 运行、GitHub、使用说明。
   */
  embedded?: boolean;
}

const Icon: React.FC<{ d: string; size?: number }> = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** 左侧竖向活动栏：文件树 / AI 控制台 / AI 设置 / AI 运行 + 仓库入口。 */
export const ActivityRail: React.FC<Props> = ({
  explorerOpen,
  onToggleExplorer,
  onOpenAiConsole,
  onOpenAiSettings,
  onRun,
  runBusy,
  aiConsoleOpen,
  aiSettingsOpen,
  onOpenAssistant,
  aiAssistantOpen,
  onOpenHarness,
  embedded = false,
}) => (
  <nav className="va-rail" aria-label="VelAgent 活动栏">
    <button
      type="button"
      className={'va-rail-btn' + (explorerOpen ? ' is-active' : '')}
      title={explorerOpen ? '隐藏文件树' : '显示文件树'}
      aria-label="文件树"
      onClick={onToggleExplorer}
    >
      <Icon d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4l2 2h7A1.5 1.5 0 0 1 20 7.5v10A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-12z" />
    </button>
    {!embedded && (
      <>
        <button
          type="button"
          className={'va-rail-btn va-rail-btn--primary' + (aiAssistantOpen ? ' is-active' : '')}
          title="AI 助手（内嵌 DeepSeek Harness：改画布 / 写代码）"
          aria-label="AI 助手"
          onClick={onOpenAssistant}
        >
          <Icon d="M4 5h16v10H9l-4 4V5zM8 9h8M8 12h5" />
        </button>
        <button
          type="button"
          className="va-rail-btn"
          title="DeepSeek Harness 官方界面（安装插件 / 设置 / 完整对话）"
          aria-label="Harness 官方界面"
          onClick={onOpenHarness}
        >
          <Icon d="M4 5h16v4H4zM4 11h10v4H4zM16 11h4v8h-4zM4 17h10v2H4z" />
        </button>
        <button
          type="button"
          className={'va-rail-btn' + (aiConsoleOpen ? ' is-active' : '')}
          title="AI 控制台（地址 / 令牌 / 权限）"
          aria-label="AI 控制台"
          onClick={onOpenAiConsole}
        >
          <Icon d="M12 3l1.9 4.3L18 9.2l-4.1 1.9L12 15.4l-1.9-4.3L6 9.2l4.1-1.9L12 3zM18 15l.95 2.05L21 18l-2.05.95L18 21l-.95-2.05L15 18l2.05-.95L18 15z" />
        </button>
        <button
          type="button"
          className={'va-rail-btn' + (aiSettingsOpen ? ' is-active' : '')}
          title="AI 设置（服务商 / 模型 / Key）"
          aria-label="AI 设置"
          onClick={onOpenAiSettings}
        >
          <Icon d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3" />
          <circle cx="15.5" cy="7" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="9.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="17" r="1.6" fill="currentColor" stroke="none" />
        </button>
      </>
    )}
    <button
      type="button"
      className={'va-rail-btn' + (runBusy ? ' is-active' : '')}
      title={runBusy ? '停止运行预测' : 'AI 运行预测（LED / 串口动画）'}
      aria-label="AI 运行"
      onClick={onRun}
    >
      {runBusy ? <Icon d="M7 7h10v10H7z" /> : <Icon d="M8 5.5v13l10-6.5-10-6.5z" />}
    </button>
    <div className="va-rail-spacer" />
    <div className="va-rail-sep" />
    <button
      type="button"
      className="va-rail-btn"
      title="GitHub 仓库"
      aria-label="GitHub 仓库"
      onClick={() => openExternal('https://github.com/enruiAI/VelAgent')}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
      </svg>
    </button>
    <button
      type="button"
      className="va-rail-btn"
      title="使用说明 / README"
      aria-label="使用说明"
      onClick={() => openExternal('https://github.com/enruiAI/VelAgent#readme')}
    >
      <Icon d="M12 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12 16.5v-4M12 9.6v-.2" />
    </button>
  </nav>
);
