import React from 'react';
import { Link } from 'react-router-dom';
import { BrandIcon } from './BrandIcon';
import { openExternal } from '../../integration/openExternal';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';
import './LanguageSwitcher.css';

/** VelAgent 顶栏：品牌 + 菜单槽位 + 工具栏槽位 + 右侧工具。 */
interface AppHeaderProps {
  editorMenu?: React.ReactNode;
  editorToolbar?: React.ReactNode;
  /**
   * 品牌是否为路由链接。独立版走 react-router 的 /editor；嵌入 Harness dock 时
   * 没有该路由（也不该整页跳走），渲染成静态品牌块。
   */
  brandLink?: boolean;
  /** 关闭嵌入的工作台（Harness dock 传入）。 */
  onClose?: () => void;
}

const brandContent = (
  <>
    <span className="va-brand-badge">
      <BrandIcon size={19} />
    </span>
    <span>
      <div className="va-brand-name">VelAgent</div>
      <div className="va-brand-tag">AI 硬件实验台</div>
    </span>
  </>
);

export const AppHeader: React.FC<AppHeaderProps> = ({ editorMenu, editorToolbar, brandLink = true, onClose }) => (
  <header className="app-header va-header">
    {brandLink ? (
      <Link to="/editor" className="va-brand" title="VelAgent — AI 硬件实验台">
        {brandContent}
      </Link>
    ) : (
      <div className="va-brand" title="VelAgent — AI 硬件实验台">
        {brandContent}
      </div>
    )}

    {editorMenu}

    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
      {editorToolbar}
    </div>

    <a
      href="https://github.com/enruiAI/VelAgent"
      target="_blank"
      rel="noreferrer"
      title="VelAgent GitHub 仓库"
      onClick={(e) => {
        e.preventDefault();
        openExternal('https://github.com/enruiAI/VelAgent');
      }}
      style={{ color: 'inherit', opacity: 0.65, display: 'flex', alignItems: 'center', padding: '0 4px' }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
      </svg>
    </a>
    <LanguageSwitcher />
    <ThemeToggle />
    {onClose !== undefined && (
      <button
        type="button"
        title="关闭工作台"
        aria-label="关闭工作台"
        onClick={onClose}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, marginLeft: 2, padding: 0,
          border: 'none', borderRadius: 7, background: 'transparent',
          color: 'inherit', cursor: 'pointer', opacity: 0.72,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(127,127,127,0.18)' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.72'; e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    )}
  </header>
);
