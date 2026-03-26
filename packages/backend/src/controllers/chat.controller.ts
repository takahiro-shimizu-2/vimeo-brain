import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ChatService } from '../services/chat.service.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../errors/app-error.js';

const chatSchema = z.object({
  session_id: z.string().uuid().optional(),
  message: z.string().min(1).max(10000),
});

export function createChatRouter(pool: Pool): Router {
  const router = Router();
  const chatService = new ChatService(pool);

  router.post('/api/chat', validate(chatSchema), async (req, res, next) => {
    try {
      const { session_id, message } = req.body as {
        session_id?: string;
        message: string;
      };
      const result = await chatService.chat(session_id, message);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/chat/sessions', async (_req, res, next) => {
    try {
      const sessions = await chatService.getSessions();
      res.json({ success: true, data: sessions });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/chat/sessions/:sessionId', async (req, res, next) => {
    try {
      const session = await chatService.getSession(req.params.sessionId);
      if (!session) throw AppError.notFound('Session not found');
      res.json({ success: true, data: session });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/api/chat/sessions/:sessionId', async (req, res, next) => {
    try {
      const deleted = await chatService.deleteSession(req.params.sessionId);
      if (!deleted) throw AppError.notFound('Session not found');
      res.json({ success: true, message: 'Session deleted' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
