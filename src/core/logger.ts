import { appendFile } from 'node:fs/promises';
import { redact } from './redact.js';

/**
 * Journal local, append-only, en JSONL.
 *
 * Ce journal est un SECOND registre, indépendant de l'audit applicatif de
 * marc-andre-app (qui est best-effort, fire-and-forget, et peut perdre des
 * entrées en cas d'écriture concurrente — voir le rapport d'architecture).
 * Utile précisément le jour où l'un des deux registres a un trou.
 *
 * Règle stricte : RIEN n'est écrit sur stdout ici. stdout est réservé au
 * protocole (dans une variante stdio future) — un simple console.log de
 * débogage suffit à casser un transport MCP. On log sur stderr + fichier.
 */

export interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private readonly filePath: string) {}

  private async write(entry: LogEntry) {
    const safe = redact(entry) as LogEntry;
    const line = JSON.stringify(safe) + '\n';
    process.stderr.write(line);
    try {
      await appendFile(this.filePath, line, 'utf8');
    } catch {
      // Le journal local ne doit jamais faire échouer l'action métier
      // appelante — même règle que logAction() côté marc-andre-app.
    }
  }

  info(event: string, data: Record<string, unknown> = {}) {
    return this.write({ ts: new Date().toISOString(), level: 'info', event, ...data });
  }

  warn(event: string, data: Record<string, unknown> = {}) {
    return this.write({ ts: new Date().toISOString(), level: 'warn', event, ...data });
  }

  error(event: string, data: Record<string, unknown> = {}) {
    return this.write({ ts: new Date().toISOString(), level: 'error', event, ...data });
  }
}
