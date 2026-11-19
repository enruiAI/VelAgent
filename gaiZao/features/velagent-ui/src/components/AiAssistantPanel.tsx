/**
 * AI 助手 —— 内嵌 DeepSeek Harness 的聊天面板（M6）。
 *
 * Rust 负责拉起 dsh 运行时；这里只负责：
 *  - 展示对话 / 工具调用 / 错误；
 *  - 把用户输入通过 invoke('harness_prompt') 发给运行时；
 *  - 监听 velagent://harness 事件，把桥转发的事件渲染成聊天记录。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop } from '../integration/controlBridge';
import { BrandIcon } from './layout/BrandIcon';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

type MessageKind = 'user' | 'assistant' | 'tool' | 'error' | 'note';

interface ChatMessage {
  id: string;
  kind: MessageKind;
  text: string;
  name?: string;
  ok?: boolean;
  time: number;
}

interface HarnessStatusView {
  running: boolean;
  enabled: boolean;
  repo: string;
  bridge: string;
  home: string;
  model: string;
  provider: string;
  error?: string | null;
}

let messageSeq = 0;
const nextId = () => 'm' + ++messageSeq;

function summarizeArguments(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['kind', 'metadata_id', 'pin', 'owner_id', 'path', 'file', 'text']) {
      if (parsed[key] !== undefined) parts.push(key + '=' + String(parsed[key]));
    }
    if (parts.length === 0) return Object.keys(parsed).slice(0, 3).join(', ');
    return parts.join(' · ');
  } catch {
    return raw.slice(0, 120);
  }
}

export const AiAssistantPanel: React.FC<Props> = ({ open, onClose, onOpenSettings }) => {
  const desktop = isDesktop();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<HarnessStatusView | null>(null);
  const [bootError, setBootError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  const push = useCallback((message: Omit<ChatMessage, 'id' | 'time'>) => {
    setMessages((prev) => [...prev, { ...message, id: nextId(), time: Date.now() }]);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const view = await invoke<HarnessStatusView>('harness_status');
      setStatus(view);
      return view;
    } catch (error) {
      setBootError(String((error as Error)?.message ?? error));
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    try {
      const view = await invoke<HarnessStatusView>('harness_start');
      setStatus(view);
      setBootError('');
      startedRef.current = true;
    } catch (error) {
      setBootError(String((error as Error)?.message ?? error));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const view = await refreshStatus();
      if (view && view.running) return;
      await start();
    })();
  }, [open, refreshStatus, start]);

  useEffect(() => {
    if (!open || !desktop) return;
    let disposed = false;
    const unlistenPromise = listen<{ type: string; line?: string; running?: boolean }>('velagent://harness', (event) => {
      if (disposed) return;
      const payload = event.payload;
      if (payload.type === 'process') {
        if (payload.running === false) setBusy(false);
        return;
      }
      if (payload.type !== 'raw' || !payload.line) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(payload.line) as Record<string, unknown>;
      } catch {
        return;
      }
      const kind = String(message.type ?? '');
      if (kind === 'ready') {
        push({ kind: 'note', text: 'harness 已连接 · ' + String(message.model ?? '') });
        return;
      }
      if (kind === 'status') {
        const state = String(message.state);
        setBusy(state === 'running');
        return;
      }
      if (kind === 'assistant_text') {
        push({ kind: 'assistant', text: String(message.text ?? '') });
        return;
      }
      if (kind === 'tool_start') {
        push({
          kind: 'tool',
          name: String(message.name ?? 'tool'),
          text: summarizeArguments(String(message.arguments ?? '')),
          ok: undefined,
        });
        return;
      }
      if (kind === 'tool_end') {
        push({ kind: 'tool', name: String(message.callId ?? 'tool'), text: String(message.text ?? '').slice(0, 400), ok: message.ok !== false });
        return;
      }
      if (kind === 'done') {
        setBusy(false);
        return;
      }
      if (kind === 'error') {
        const text = String(message.message ?? '未知错误');
        const hint = /MISSING_CREDENTIAL|API key|api_key|DEEPSEEK_API_KEY/i.test(text)
          ? '\n请在「AI 设置」里配置 DeepSeek API Key（内嵌 harness 使用 DEEPSEEK_API_KEY）。'
          : '';
        push({ kind: 'error', text: text + hint });
        setBusy(false);
      }
    });
    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [open, desktop, push]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!status?.running) await start();
    setInput('');
    push({ kind: 'user', text });
    setBusy(true);
    try {
      await invoke('harness_prompt', { text });
    } catch (error) {
      push({ kind: 'error', text: String((error as Error)?.message ?? error) });
      setBusy(false);
    }
  }, [busy, input, push, start, status?.running]);

  const stop = useCallback(async () => {
    try {
      await invoke('harness_stop');
    } catch {
      /* 停止失败也把 UI 置空 */
    }
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  const headerHint = useMemo(() => {
    if (!desktop) return '浏览器预览模式';
    if (bootError) return '未就绪';
    if (!status) return '连接中…';
    return (status.model || 'DeepSeek') + ' · ' + (status.provider || 'deepseek-official');
  }, [desktop, bootError, status]);

  if (!open) return null;

  return (
    <aside className="va-ai-panel" aria-label="AI 助手">
      <div className="va-ai-head">
        <span className="va-brand-badge" style={{ width: 26, height: 26, borderRadius: 8 }}>
          <BrandIcon size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="va-ai-title">AI 助手</div>
          <div className="va-ai-sub">内嵌 DeepSeek Harness · {headerHint}</div>
        </div>
        <button
          type="button"
          title="清空对话"
          onClick={clear}
          style={{ background: 'transparent', border: 'none', color: 'inherit', opacity: 0.6, fontSize: 12, cursor: 'pointer' }}
        >
          清空
        </button>
        <button type="button" onClick={onClose} aria-label="关闭" style={{ background: 'transparent', border: 'none', color: 'inherit', opacity: 0.7, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>
          ×
        </button>
      </div>

      <div className="va-chat-body" ref={listRef}>
        {!desktop && (
          <div className="va-chat-note">聊天助手需要桌面端（Tauri）才能拉起内嵌 harness。</div>
        )}
        {desktop && bootError && (
          <div className="va-chat-error">
            内嵌 harness 启动失败：{bootError}
            <div className="va-chat-hint">确认已执行 pnpm install，且 harness 源码目录可被找到（config.json 的 harness.repo_path）。</div>
          </div>
        )}
        {messages.length === 0 && !bootError && (
          <div className="va-chat-empty">
            <div className="va-chat-empty-title">把想法说出来，我直接改画布 / 写代码</div>
            <div className="va-chat-empty-example">例如：把 LED 接到 GPIO4，串一个 220Ω 电阻，再写个呼吸灯程序</div>
            <div className="va-chat-empty-example">或者：检查一下我的接线哪里有问题</div>
            <button type="button" className="va-ai-btn" onClick={onOpenSettings} style={{ marginTop: 10 }}>
              打开 AI 设置
            </button>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={'va-chat-msg va-chat-msg--' + message.kind}>
            {message.kind === 'tool' ? (
              <div className="va-chat-tool">
                <span className={'va-chat-tool-dot' + (message.ok === false ? ' is-error' : message.ok ? ' is-ok' : '')} />
                <span className="va-chat-tool-name">{message.name}</span>
                {message.text && <span className="va-chat-tool-detail">{message.text}</span>}
              </div>
            ) : (
              <div className="va-chat-bubble">{message.text}</div>
            )}
          </div>
        ))}
        {busy && (
          <div className="va-chat-msg va-chat-msg--assistant">
            <div className="va-chat-bubble va-chat-typing">思考中…</div>
          </div>
        )}
      </div>

      <div className="va-chat-input">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={busy ? '等待 AI 完成…' : '描述你想改的电路 / 代码，Enter 发送'}
          rows={2}
          disabled={!desktop}
        />
        <div className="va-chat-actions">
          {busy ? (
            <button type="button" className="va-ai-btn" onClick={() => void stop()}>停止</button>
          ) : (
            <button type="button" className="va-ai-btn va-ai-btn--primary" style={{ width: 92 }} onClick={() => void send()} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
