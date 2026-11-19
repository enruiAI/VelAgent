import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import './index.css';
import './va-theme.css';
// i18next 必须在任何组件渲染之前初始化，useTranslation() 才能拿到实例。
import './i18n';
import { initTheme } from './lib/theme';
import { markProBoardsSettled } from './lib/proBoardRegistry';

// 注册所有画布用到的 Web Component（wokwi 元件 + velxio 本地元件）。
import './components/velxio-components/IC74HC595';
import './components/velxio-components/LogicGateElements';
import './components/velxio-components/TransistorElements';
import './components/velxio-components/OpAmpElements';
import './components/velxio-components/PowerElements';
import './components/velxio-components/DiodeElements';
import './components/velxio-components/RelayElements';
import './components/velxio-components/LogicICElements';
import './components/velxio-components/MotorDriverElements';
import './components/velxio-components/FlipFlopElements';
import './components/velxio-components/RaspberryPi3Element';
import './components/velxio-components/Bmp280Element';
import './components/velxio-components/Ds3231Element';
import './components/velxio-components/GpsNeo6mElement';
import './components/velxio-components/EPaperElement';

import App from './App.tsx';
import { startWorkspaceSync } from './integration/controlBridge';

// Monaco 走本地静态资源（public/monaco/vs，由 scripts/copy-monaco.mjs 在安装时复制）。
const monacoVsPath = `${import.meta.env.BASE_URL}monaco/vs`;
loader.config({ paths: { vs: monacoVsPath } });

initTheme();
// 纯前端版本没有任何 overlay 会注册板卡，直接标记注册表已就绪。
markProBoardsSettled();

createRoot(document.getElementById('root')!).render(<App />);

// 桌面端（Tauri）：把画布状态同步给 Rust，供 AI 控制面读取；浏览器下是 no-op。
startWorkspaceSync();
