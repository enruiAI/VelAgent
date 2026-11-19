/** AI 运行预测的输出面板：解释 + 警告 + 串口输出 */
import React from 'react';
import type { Playbook } from '../integration/preview';

interface Props {
  playbook: Playbook | null;
  serial: string[];
  running: boolean;
  onStop: () => void;
  onClose: () => void;
}

export const RunPreviewPanel: React.FC<Props> = ({ playbook, serial, running, onStop, onClose }) => {
  if (!playbook) return null;
  return (
    <div style={{
      position: 'absolute', left: 12, bottom: 12, width: 520, maxHeight: 320, overflow: 'auto', zIndex: 500,
      background: 'var(--wb-3, #16181d)', border: '1px solid var(--wb-7, #2a2e38)', borderRadius: 10,
      padding: 12, color: 'var(--wb-12, #e6e8ee)', fontSize: 13, boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>
          运行预测{' '}
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 8, marginLeft: 6,
            background: playbook.source === 'ai' ? '#2a4a7a' : '#3a3a2a',
            color: playbook.source === 'ai' ? '#9fd0ff' : '#e8d08a',
          }}>
            {playbook.source === 'ai' ? 'AI 推断' : '规则预测'}
          </span>
        </strong>
        <div style={{ display: 'flex', gap: 8 }}>
          {running && <button type="button" onClick={onStop}>停止</button>}
          <button type="button" onClick={onClose}>×</button>
        </div>
      </div>

      {playbook.explain && (
        <div style={{ opacity: 0.85, lineHeight: 1.7, marginBottom: 8, whiteSpace: 'pre-wrap' }}>{playbook.explain}</div>
      )}

      {playbook.warnings && playbook.warnings.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {playbook.warnings.map((w, i) => (
            <div key={i} style={{ color: '#f0b04a', lineHeight: 1.6 }}>⚠ {w}</div>
          ))}
        </div>
      )}

      {serial.length > 0 && (
        <div>
          <div style={{ opacity: 0.6, marginBottom: 4 }}>串口输出</div>
          <pre style={{
            margin: 0, padding: 8, background: '#0d0f12', borderRadius: 6,
            fontSize: 12, lineHeight: 1.5, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}>{serial.join('\n')}</pre>
        </div>
      )}

      <div style={{ marginTop: 8, opacity: 0.5, fontSize: 11 }}>
        这是行为预测，不是真实仿真；时间/外设行为仅供参考。
      </div>
    </div>
  );
};
