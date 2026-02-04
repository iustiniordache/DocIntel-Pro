/**
 * Shared Logger for Lambda Handlers
 * Uses pino for structured logging
 */

import pino from 'pino';
import { config } from './config';

let loggerInstance: pino.Logger | null = null;

/**
 * Get or create the shared logger instance
 */
export const getLogger = (): pino.Logger => {
  if (!loggerInstance) {
    loggerInstance = pino({
      level: config().logging.level,
      formatters: {
        level: (label) => ({ level: label }),
      },
    });
  }
  return loggerInstance;
};
