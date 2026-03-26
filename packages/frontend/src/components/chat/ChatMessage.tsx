import { Box, Paper, Typography } from '@mui/material';
import { SourceCard } from './SourceCard';
import type { ChatMessage as ChatMessageType } from '../../api/chat.api';

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user';

  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Paper
        elevation={0}
        sx={{
          p: 2,
          maxWidth: '80%',
          bgcolor: isUser ? 'primary.main' : 'background.paper',
          color: isUser ? 'primary.contrastText' : 'text.primary',
        }}
      >
        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Typography>
        {message.sources && message.sources.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {message.sources.map((source, i) => (
              <SourceCard key={i} source={source} />
            ))}
          </Box>
        )}
      </Paper>
    </Box>
  );
}
