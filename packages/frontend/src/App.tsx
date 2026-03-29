import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ChatPage } from './pages/ChatPage';
import { SourcesPage } from './pages/SourcesPage';
import { SourceDetailPage } from './pages/SourceDetailPage';

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/sources/:id" element={<SourceDetailPage />} />
        {/* Backward compatibility redirects */}
        <Route path="/videos" element={<Navigate to="/sources" replace />} />
        <Route path="/videos/:id" element={<Navigate to="/sources" replace />} />
      </Routes>
    </AppLayout>
  );
}
