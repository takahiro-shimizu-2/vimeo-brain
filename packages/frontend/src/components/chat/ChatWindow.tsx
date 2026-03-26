import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';
import { ChatMessage as ChatMessageComponent } from './ChatMessage';
import type { ChatMessage } from '../../api/chat.api';

export function ChatWindow({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {messages.length === 0 && (
        <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 8 }}>
          <Box sx={{ fontSize: 48, mb: 2 }}>🧠</Box>
          <Box>Vimeo動画の内容について質問してください</Box>
        </Box>
      )}
      {messages.map(msg => (
        <ChatMessageComponent key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </Box>
  );
}
