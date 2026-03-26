import { Box, CircularProgress } from '@mui/material';
import { useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { ChatWindow } from '../components/chat/ChatWindow';
import { ChatInput } from '../components/chat/ChatInput';
import { useChat } from '../hooks/useChat';

export function ChatPage() {
  const { sessionId } = useParams();
  const { messages, loading, sendMessage, loadSession } = useChat(sessionId);

  useEffect(() => {
    if (sessionId) loadSession(sessionId);
  }, [sessionId, loadSession]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ChatWindow messages={messages} />
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 1 }}>
          <CircularProgress size={24} />
        </Box>
      )}
      <ChatInput onSend={sendMessage} disabled={loading} />
    </Box>
  );
}
