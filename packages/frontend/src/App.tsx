import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ChatPage } from './pages/ChatPage';
import { VideosPage } from './pages/VideosPage';
import { VideoDetailPage } from './pages/VideoDetailPage';

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/videos" element={<VideosPage />} />
        <Route path="/videos/:id" element={<VideoDetailPage />} />
      </Routes>
    </AppLayout>
  );
}
