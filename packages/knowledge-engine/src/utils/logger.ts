import pino from 'pino';

export const logger = pino({
  name: 'knowledge-engine',
  level: process.env.LOG_LEVEL || 'info',
});
