import pino from 'pino';

/**
 * Central logger (level-based).
 *
 * Env:
 * - LOG_LEVEL: trace|debug|info|warn|error|fatal|silent (default: info, or silent in tests)
 */
const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const logger = pino({
  level,
  // Keep logs safe by default; do not log objects containing secrets.
  redact: {
    paths: ['*.privateKey', '*.privyAppSecret', '*.secretKey', '*.password', '*.apiKey'],
    remove: true,
  },
});

