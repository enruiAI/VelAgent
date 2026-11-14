/**
 * AI 控制台 —— VelAgent 的"任务控制台"：把本地控制面地址 / 令牌交给 harness，
 * 并实时显示画布变更事件（AI 或用户操作都会出现在这里）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getControlInfo, isDesktop, rotateToken, setAiCanWrite, type ControlInfo } from '../integration/controlBridge';
import { BrandIcon } from './layout/BrandIcon';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface AuditItem {
  at: number;
  event?: { type?: string; revision?: number };
}

export const AiControlPanel: React.FC<Props> = ({ open, onClose }) => {
  const [info, setInfo] = useState<ControlInfo | null>(null);
  const [status, setStatus] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [events, setEvents] = useState<AuditItem[]>([]);
  const desktop = isDesktop();

  useEffect(() => {
    if (!open) return;
    void getControlInfo().then(setInfo);
  }, [open]);

  const loadEvents = useCallback(async () => {
    if (!desktop) return;
    try {
      const items = await invoke<AuditItem[]>('get_audit_log');
      setEvents((items ?? []).slice(-6).reverse());
    } catch {
      /* 事件流只是锦上添花，失败静默 */
    }
  }, [desktop]);

  useEffect(() => {
    if (!open || !desktop) return;
    void loadEvents();
    const timer = window.setInterval(() => void loadEvents(), 3000);
    return () => window.clearInterval(timer);
  }, [open, desktop, loadEvents]);

  if (!open) return null;

  const base = info ? 'http://127.0.0.1:' + info.port : '';
  const handoff = info
    ? '地址: ' + base + '\nToken: ' + info.token + '\n文档: ' + base + '/llms.txt\nOpenAPI: ' + base + '/api/v1/openapi.json'
    : '';
  const maskedToken = info && !showToken ? info.token.slice(0, 8) + '••••••••' + info.token.slice(-4) : info?.token ?? '';

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已复制' + label);
    } catch {
      setStatus('复制失败，请手动选择文本');
    }
  };

  const formatTime = (ms: number) => {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  };

  return (
    <aside className="va-ai-panel" aria-label="AI 控制台">
      <div className="va-ai-head">
        <span className="va-brand-badge" style={{ width: 26, height: 26, borderRadius: 8 }}>
          <BrandIcon size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="va-ai-title">AI 控制台</div>
          <div className="va-ai-sub">
            {desktop ? '本机控制面 · 供 Claude Code / Cursor / 自研 agent 连接' : '浏览器预览模式'}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭" style={{ background: 'transparent', border: 'none', color: 'inherit', opacity: 0.7, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
      </div>

      <div className="va-ai-body">
        {!desktop && (
          <div className="va-ai-section" style={{ color: '#ffb020', lineHeight: 1.7 }}>
            当前是浏览器预览，本地控制面不可用。<br />
            运行桌面端后，这里会显示地址与令牌。
          </div>
        )}

        {desktop && info && (
          <>
            <div className="va-ai-section">
              <div className="va-ai-label">连接</div>
              <div className="va-ai-code" style={{ marginBottom: 6 }}>
                <span>{base}</span>
                <button type="button" className="va-ai-btn" onClick={() => void copy(base, '地址')}>复制</button>
              </div>
              <div className="va-ai-code" style={{ marginBottom: 8 }}>
                <span>{maskedToken}</span>
                <button type="button" className="va-ai-btn" onClick={() => setShowToken((v) => !v)}>
                  {showToken ? '隐藏' : '显示'}
                </button>
                <button type="button" className="va-ai-btn" onClick={() => void copy(info.token, '令牌')}>复制</button>
              </div>
              <button type="button" className="va-ai-btn va-ai-btn--primary" onClick={() => void copy(handoff, '连接信息')}>
                复制给 harness 的连接信息
              </button>
            </div>

            <div className="va-ai-section">
              <div className="va-ai-label">权限</div>
              <div className="va-ai-toggle">
                <div>
                  <div style={{ fontWeight: 600 }}>允许 AI 修改画布</div>
                  <div style={{ fontSize: 11, color: 'var(--va-text-dim)', marginTop: 2 }}>
                    {info.aiCanWrite ? '写接口已开启（AI 可放置元件、连线）' : '写接口关闭（只读，安全默认）'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={info.aiCanWrite}
                  style={{ width: 16, height: 16, accentColor: 'var(--va-accent)' }}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    await setAiCanWrite(enabled);
                    setInfo({ ...info, aiCanWrite: enabled });
                    setStatus(enabled ? '已允许 AI 修改画布' : 'AI 只读');
                  }}
                />
              </div>
              <button
                type="button"
                className="va-ai-btn"
                style={{ width: '100%', height: 28 }}
                onClick={async () => {
                  const token = await rotateToken();
                  if (token) setInfo({ ...info, token });
                  setStatus('令牌已轮换，harness 需要更新');
                }}
              >
                轮换令牌
              </button>
            </div>

            <div className="va-ai-section">
              <div className="va-ai-label">近况 · 画布变更</div>
              {events.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--va-text-dim)', lineHeight: 1.7 }}>
                  暂无事件。AI 或你改动画布后，这里会实时出现。
                </div>
              ) : (
                <div className="va-ai-events">
                  {events.map((item, index) => (
                    <div className="va-ai-event" key={item.at + '-' + index}>
                      <time>{formatTime(item.at)}</time>
                      <span>画布更新 · rev <b>{item.event?.revision ?? '–'}</b></span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="va-ai-section">
              <div className="va-ai-label">接口速查</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.9, color: 'var(--va-text-dim)' }}>
                <div><code>GET&nbsp; /api/v1/state</code> 画布快照</div>
                <div><code>POST /api/v1/validate</code> 接线校验</div>
                <div><code>GET&nbsp; /api/v1/events</code> 变更事件流</div>
                <div><code>POST /api/v1/run/preview</code> 行为预测</div>
                <div><code>GET&nbsp; /llms.txt</code> 给 AI 的接入指南</div>
              </div>
            </div>
          </>
        )}

        {status && <div style={{ marginTop: 4, color: 'var(--va-accent-2)', fontSize: 12 }}>{status}</div>}
      </div>
    </aside>
  );
};
