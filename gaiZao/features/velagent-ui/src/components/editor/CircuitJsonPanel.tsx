/**
 * 电路 JSON 面板：画布 ⇄ JSON 的双向视图（人机共创入口）。
 *
 * - 画布变化（拖元件、AI 调工具）→ 没有未应用的编辑时自动刷新文本；
 * - 人改文本 → 点「应用到画布」→ 校验通过才写回画布，失败不动画布；
 * - AI 与用户看的是同一份 JSON（工具 velagent_read_circuit_json / apply）。
 */
import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimulatorStore } from '../../store/useSimulatorStore';
import { applyCircuitJson, buildCircuitJson } from '../../integration/circuitJson';
import { defineVelxioThemes, monacoThemeFor } from './monacoThemes';
import { useResolvedTheme } from '../../hooks/useTheme';

type StatusKind = 'info' | 'ok' | 'error';

interface PanelStatus {
  kind: StatusKind;
  text: string;
}

const statusColor: Record<StatusKind, string> = {
  info: 'var(--wb-9)',
  ok: '#22c55e',
  error: '#ef4444',
};

/** 把画布状态序列化成可读 JSON 文本。 */
function currentText(): string {
  return JSON.stringify(buildCircuitJson(), null, 2);
}

export const CircuitJsonPanel = () => {
  const theme = monacoThemeFor(useResolvedTheme());
  const [text, setText] = useState<string>(() => currentText());
  const [status, setStatus] = useState<PanelStatus>({
    kind: 'info',
    text: '画布与 JSON 已同步 · 改完点「应用到画布」',
  });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const syncedRef = useRef(text);

  const refresh = useCallback((message = '已从画布刷新') => {
    try {
      const next = currentText();
      syncedRef.current = next;
      setText(next);
      setDirty(false);
      dirtyRef.current = false;
      setStatus({ kind: 'info', text: message });
    } catch (error) {
      setStatus({ kind: 'error', text: '读取画布失败：' + String(error) });
    }
  }, []);

  // 画布变化（用户拖动 / AI 工具）→ 自动同步；用户有未应用编辑时保留编辑内容。
  useEffect(() => {
    const unsubscribe = useSimulatorStore.subscribe(() => {
      if (dirtyRef.current || busyRef.current) return;
      try {
        const next = currentText();
        if (next === syncedRef.current) return;
        syncedRef.current = next;
        setText(next);
      } catch {
        /* 画布过渡态读不到时忽略，下一次变化再同步 */
      }
    });
    return unsubscribe;
  }, []);

  const apply = useCallback(async () => {
    busyRef.current = true;
    setBusy(true);
    setStatus({ kind: 'info', text: '正在应用到画布…' });
    try {
      const parsed: unknown = JSON.parse(text);
      const result = await applyCircuitJson(parsed);
      if (result.ok) {
        const next = currentText();
        syncedRef.current = next;
        setText(next);
        setDirty(false);
        dirtyRef.current = false;
        setStatus({ kind: 'ok', text: '已应用到画布' });
      } else {
        setStatus({ kind: 'error', text: '未应用：' + result.issues.slice(0, 3).join('；') });
      }
    } catch (error) {
      setStatus({ kind: 'error', text: 'JSON 解析失败：' + String(error) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [text]);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--wb-7)',
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 12 }}>电路 JSON</strong>
        <span style={{ fontSize: 11, color: statusColor[status.kind], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={status.text}>
          {status.text}
        </span>
        <button type="button" className="va-action" onClick={() => refresh()} disabled={busy} title="丢弃编辑，按画布重新生成">
          刷新
        </button>
        <button
          type="button"
          className={'va-action va-action--primary'}
          onClick={() => void apply()}
          disabled={busy || !dirty}
          title="校验并写回画布"
        >
          应用到画布
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Editor
          height="100%"
          language="json"
          theme={theme}
          value={text}
          beforeMount={defineVelxioThemes}
          onChange={(value) => {
            const next = value ?? '';
            setText(next);
            const changed = next !== syncedRef.current;
            setDirty(changed);
            dirtyRef.current = changed;
            if (changed) setStatus({ kind: 'info', text: '有未应用的修改 · 点「应用到画布」生效' });
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fixedOverflowWidgets: true,
          }}
        />
      </div>
    </div>
  );
};
