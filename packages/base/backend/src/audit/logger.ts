// Structured audit + app logging.
//
// OWASP A09 — every security-relevant action calls auditLog(). Audit entries
// go to audit-YYYY-MM-DD.log (kept for 1 year). General app logs go to
// app-YYYY-MM-DD.log (kept for 30 days). Both rotate by date and size.
//
// Dev (NODE_ENV !== production): also tee to console for ergonomics.
// Prod: file only — console output is silenced.
//
// Redaction (security/secrets.redactSecrets) runs at the logger level so it
// applies to every transport. Even if a caller hands the logger an object
// containing a password / token / api key it will be replaced with
// [REDACTED] before serialisation.

import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { loadEnv } from '../config/env';
import { isSecretKey, redactSecrets } from '../security/secrets';

// When a caller does `logger.info({ msg: 'x', foo: 1 })` the logger library
// stuffs the whole object into info.message rather than spreading it.
// Flatten it back so downstream formats (and the audit-only filter) see
// top-level keys.
const flattenObjectMessage = winston.format((info) => {
  const msg = info.message;
  if (msg !== null && typeof msg === 'object' && !(msg instanceof Error) && !Array.isArray(msg)) {
    const obj = msg as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if ((info as Record<string, unknown>)[k] === undefined) {
        (info as Record<string, unknown>)[k] = v;
      }
    }
    info.message = (obj.msg as string) ?? (obj.action as string) ?? '';
  }
  return info;
})();

// Mutate in place — the logger tracks state via Symbols on the info instance
// (Symbol(level), Symbol(message), Symbol(splat)); returning a deep clone
// loses them. Touch only string-keyed properties.
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    const val = (info as Record<string, unknown>)[key];
    if (isSecretKey(key)) {
      (info as Record<string, unknown>)[key] = '[REDACTED]';
    } else if (val !== null && typeof val === 'object') {
      (info as Record<string, unknown>)[key] = redactSecrets(val);
    }
  }
  return info;
})();

const auditOnly = winston.format((info) => (info.audit === true ? info : false))();

let cached: winston.Logger | undefined;

export function getLogger(): winston.Logger {
  if (cached) return cached;
  const env = loadEnv();
  const logDir = path.resolve(env.LOG_DIR);
  fs.mkdirSync(logDir, { recursive: true });

  const transports: winston.transport[] = [];

  // App log — everything.
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '20m',
      auditFile: path.join(logDir, '.app-rotation.json'),
      level: env.LOG_LEVEL,
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
  );

  // Audit log — only entries flagged audit:true. Retained 1 year.
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'audit-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '365d',
      maxSize: '20m',
      auditFile: path.join(logDir, '.audit-rotation.json'),
      level: 'info',
      format: winston.format.combine(auditOnly, winston.format.timestamp(), winston.format.json()),
    }),
  );

  // Dev convenience: tee to console.
  if (env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        level: env.LOG_LEVEL,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf((info) => {
            const tag = info.audit ? '[AUDIT]' : '[app]';
            const rest = { ...info } as Record<string, unknown>;
            delete rest.level;
            delete rest.timestamp;
            delete rest.message;
            delete rest.audit;
            const restJson = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '';
            return `${info.timestamp as string} ${info.level.toUpperCase()} ${tag} ${
              info.message ?? ''
            } ${restJson}`.trim();
          }),
        ),
      }),
    );
  }

  cached = winston.createLogger({
    level: env.LOG_LEVEL,
    format: winston.format.combine(flattenObjectMessage, redactFormat),
    transports,
    exitOnError: false,
  });

  return cached;
}

export interface AuditEntry {
  action: string;            // e.g. 'login.success', 'token.refresh', 'ha.command'
  userId?: string;
  ip?: string;
  result: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
}

export function auditLog(entry: AuditEntry): void {
  getLogger().info({ audit: true, ...entry });
}

export function __resetLoggerForTests(): void {
  if (cached) {
    cached.close();
    cached = undefined;
  }
}
