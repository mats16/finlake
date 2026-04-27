import pino from 'pino';

export const logger = pino({
  name: 'lakecost-db',
  level: process.env.LOG_LEVEL ?? 'info',
});
