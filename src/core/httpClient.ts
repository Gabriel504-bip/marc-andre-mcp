import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from '../config.js';
import { Logger } from './logger.js';
import { UpstreamError, UpstreamTimeoutError } from './errors.js';

/**
 * SEUL module qui fait du réseau vers marc-andre-app. C'est ce qui rend
 * l'authentification, le caviardage, les délais et les reprises
 * vérifiables en un seul endroit — aucun `fetch` ne doit apparaître
 * ailleurs dans le projet.
 *
 * Contrat côté marc-andre-app attendu (spécifié dans PALIERS.md, PAS
 * encore implémenté — à faire au GO) :
 *   GET  /api/agent/health           → { ok, tier1, tier2Enabled, qboWriteEnabled, safeModeEmail }
 *   GET  /api/agent/tools            → catalogue des outils permis (source de vérité serveur)
 *   POST /api/agent/invoke           → { tool, input, requestId } → résultat de l'outil
 *
 * En-têtes envoyés sur CHAQUE appel (jamais de secret en query string —
 * contrairement au patron `?adminKey=` observé dans marc-andre-app, qui
 * finit dans les journaux de plateforme) :
 *   Authorization: Bearer <MA_AGENT_KEY>
 *   X-Agent-Id: <MA_AGENT_ID>
 *   X-Agent-Request-Id: <uuid>
 */

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

export class MarcAndreHttpClient {
  constructor(private readonly config: Config, private readonly logger: Logger) {}

  async invoke<TResult = unknown>(
    tool: string,
    input: unknown,
    requestId: string,
    opts: { timeoutMs?: number } = {}
  ): Promise<TResult> {
    const url = `${this.config.maBaseUrl}/api/agent/invoke`;
    const body = JSON.stringify({ tool, input, requestId });
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(2000 * 2 ** (attempt - 1), 8000) + Math.random() * 250;
        await delay(backoff);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.maAgentKey}`,
            'x-agent-id': this.config.maAgentId,
            'x-agent-request-id': requestId,
          },
          body,
          signal: controller.signal,
        });

        const raw = await res.text();

        if (!res.ok) {
          if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
            await this.logger.warn('upstream_retry', { tool, status: res.status, attempt });
            lastErr = new UpstreamError(tool, res.status, this.safeSnippet(raw));
            continue;
          }
          throw new UpstreamError(tool, res.status, this.safeSnippet(raw));
        }

        // Garde « réponse non-JSON » — même piège que parseJsonResponse()
        // côté page client de marc-andre-app (page d'erreur Vercel HTML
        // renvoyée avec un statut 200, ou un timeout de plateforme muet).
        try {
          return JSON.parse(raw) as TResult;
        } catch {
          throw new UpstreamError(
            tool,
            res.status,
            `réponse non-JSON reçue (${this.safeSnippet(raw)}) — probable erreur de plateforme amont`
          );
        }
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        if ((err as Error)?.name === 'AbortError') {
          throw new UpstreamTimeoutError(tool, timeoutMs);
        }
        lastErr = err;
        if (attempt >= MAX_RETRIES) {
          throw new UpstreamError(tool, 0, 'échec réseau après plusieurs tentatives', {
            cause: err,
          });
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new UpstreamError(tool, 0, 'échec inconnu après retries');
  }

  async health(): Promise<{
    ok: boolean;
    tier1: boolean;
    tier2Enabled: boolean;
    qboWriteEnabled: boolean;
    safeModeEmail: string | null;
  }> {
    return this.invoke('__health__', {}, 'health-check');
  }

  private safeSnippet(raw: string): string {
    return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
  }
}
