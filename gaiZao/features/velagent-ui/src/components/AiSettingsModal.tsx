/**
 * AI 设置：用户自带 API Key（OpenAI 兼容接口）。
 * Key 保存在本机配置（桌面端由 Rust 落盘），不是云端。
 */
import React, { useEffect, useState } from 'react';
import {
  getAiSettings,
  isDesktop,
  saveAiSettings,
  testAiConnection,
} from '../integration/controlBridge';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Preset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

const PRESETS: Preset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'moonshot', label: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'qwen', label: '通义千问（兼容模式）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'ollama', label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1' },
  { id: 'custom', label: '自定义', baseUrl: '', model: '' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--wb-2, #101216)',
  color: 'inherit',
  border: '1px solid var(--wb-7, #2a2e38)',
  borderRadius: 6,
  padding: '7px 9px',
  fontSize: 13,
};

export const AiSettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const [provider, setProvider] = useState('deepseek');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [model, setModel] = useState('deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getAiSettings().then((cfg) => {
      if (!cfg) return;
      setProvider(cfg.provider || 'deepseek');
      setBaseUrl(cfg.base_url || PRESETS[0].baseUrl);
      setModel(cfg.model || PRESETS[0].model);
      setHasKey(cfg.has_key);
    });
  }, [open]);

  if (!open) return null;

  const applyPreset = (id: string) => {
    setProvider(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const save = async () => {
    setBusy(true);
    setStatus('');
    const ok = await saveAiSettings({ provider, base_url: baseUrl, model, api_key: apiKey || undefined });
    setBusy(false);
    if (ok) {
      setStatus('已保存');
      setHasKey(hasKey || !!apiKey);
      setApiKey('');
    } else {
      setStatus('保存失败（仅桌面端可持久化）');
    }
  };

  const test = async () => {
    setBusy(true);
    setStatus('正在测试连接…');
    const res = await testAiConnection();
    setBusy(false);
    setStatus(res.ok ? '连接成功：' + (res.reply ?? '') : '连接失败：' + (res.error ?? '未知错误'));
  };

  return (
    <div style={{
      position: 'absolute', top: 52, right: 40, width: 460, zIndex: 600,
      background: 'var(--wb-3, #16181d)', border: '1px solid var(--wb-7, #2a2e38)',
      borderRadius: 10, padding: 16, color: 'var(--wb-12, #e6e8ee)', fontSize: 13,
      boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong>AI 设置</strong>
        <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer' }}>×</button>
      </div>

      {!isDesktop() && (
        <div style={{ color: '#f0b04a', marginBottom: 10, lineHeight: 1.6 }}>
          浏览器预览无法保存 Key / 调用 AI；请运行桌面端（在 <code>gaiZao/tauri</code> 里 <code>cargo run</code>）。
        </div>
      )}

      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ marginBottom: 4, opacity: 0.75 }}>服务商</div>
        <select value={provider} onChange={(e) => applyPreset(e.target.value)} style={inputStyle}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ marginBottom: 4, opacity: 0.75 }}>Base URL（OpenAI 兼容接口，末尾通常带 /v1）</div>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={inputStyle} placeholder="https://api.deepseek.com/v1" />
      </label>

      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ marginBottom: 4, opacity: 0.75 }}>模型</div>
        <input value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle} placeholder="deepseek-chat" />
      </label>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <div style={{ marginBottom: 4, opacity: 0.75 }}>
          API Key {hasKey ? <span style={{ color: '#7ede9a' }}>（已保存，留空则不修改）</span> : '（本机保存，不上传）'}
        </div>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={inputStyle} placeholder={hasKey ? '••••••••' : 'sk-...'} />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void save()} disabled={busy} style={{ flex: 1, padding: '7px 0' }}>保存</button>
        <button type="button" onClick={() => void test()} disabled={busy || !isDesktop()} style={{ flex: 1, padding: '7px 0' }}>测试连接</button>
      </div>
      {status && <div style={{ marginTop: 10, lineHeight: 1.6, opacity: 0.9 }}>{status}</div>}

      <div style={{ marginTop: 12, opacity: 0.55, lineHeight: 1.6, fontSize: 12 }}>
        提示：运行预测只发送「电路结构 + 当前文件代码」，不发送其它文件；换成本地 Ollama 可完全离线。
      </div>
    </div>
  );
};
