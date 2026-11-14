import React, { useEffect, useState } from 'react';
import { getControlInfo, isDesktop } from '../../integration/controlBridge';

interface Props {
  onClick: () => void;
}

/** 顶栏 AI 状态：只读 / 可写 / 浏览器预览。点击打开 AI 控制台。 */
export const AiStatusPill: React.FC<Props> = ({ onClick }) => {
  const [writable, setWritable] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const load = async () => {
      const info = await getControlInfo();
      if (!alive || !info) return;
      setWritable(info.aiCanWrite);
      setPort(info.port);
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [desktop]);

  if (!desktop) {
    return (
      <button type="button" className="va-status-pill" onClick={onClick} title="浏览器预览，本地控制面不可用">
        <span className="va-dot va-dot--offline" />
        浏览器预览
      </button>
    );
  }

  return (
    <button
      type="button"
      className="va-status-pill"
      onClick={onClick}
      title={writable ? 'AI 可以修改画布（点击打开 AI 控制台）' : 'AI 只读（点击打开 AI 控制台开启写权限）'}
    >
      <span className={'va-dot' + (writable ? '' : ' va-dot--readonly')} />
      {writable ? 'AI 可写' : 'AI 只读'}
      {port && <span style={{ opacity: 0.55 }}>:{port}</span>}
    </button>
  );
};
