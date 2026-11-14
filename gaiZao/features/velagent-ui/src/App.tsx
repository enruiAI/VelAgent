import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { EditorPage } from './pages/EditorPage';
import { ImageToCodePage } from './pages/ImageToCodePage';
import { MessageDialogHost } from './components/ui/MessageDialogHost';
import './App.css';

/**
 * 纯前端版 Velxio：只有编辑器 + 电路画布 + 图片转 C 数组小工具。
 * 没有登录、示例库、项目云存储、编译和仿真路由。
 */
export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/editor" replace />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/tools/image-to-code" element={<ImageToCodePage />} />
        <Route path="*" element={<Navigate to="/editor" replace />} />
      </Routes>
      <MessageDialogHost />
    </Router>
  );
}
