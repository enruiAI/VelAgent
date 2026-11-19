/**
 * 语言切换器（精简版）。
 *
 * 上游通过 URL 前缀（/es/…）+ LocaleSync 切语言；精简版没有多语言路由，
 * 这里直接调用 i18n.changeLanguage：资源包懒加载，选择记在 localStorage，
 * 刷新后保持。
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { LOCALES, LOCALE_META } from '../../i18n/config';
import { setAppLanguage } from '../../i18n';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = (i18n.language || 'zh-cn').toLowerCase();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, []);

  const choose = (target: (typeof LOCALES)[number]) => {
    setOpen(false);
    void setAppLanguage(target);
  };

  return (
    <div ref={rootRef} className="velxio-language-switcher">
      <button
        type="button"
        className="velxio-language-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="语言"
        title="切换界面语言"
        onClick={() => setOpen((v) => !v)}
      >
        <Globe size={16} strokeWidth={1.8} aria-hidden="true" />
        <span className="velxio-language-current">
          {LOCALE_META[current as keyof typeof LOCALE_META]?.nativeName ?? current.toUpperCase()}
        </span>
      </button>
      {open && (
        <ul className="velxio-language-menu" role="listbox" aria-label="语言">
          {LOCALES.map((loc) => {
            const meta = LOCALE_META[loc];
            const active = loc === current;
            return (
              <li key={loc} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={'velxio-language-item' + (active ? ' velxio-language-item-active' : '')}
                  onClick={() => choose(loc)}
                  lang={meta.htmlLang}
                >
                  <span className="velxio-language-native">{meta.nativeName}</span>
                  <span className="velxio-language-code">{loc.toUpperCase()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
