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

/**
 * Un Fault QuickBooks complet (Message + Detail + code) tient sous 4 000
 * caractères. Au-delà, ce n'est plus un message d'erreur mais un dump.
 */
const MESSAGE_ERREUR_MAX = 4000;

/** Réponse non-JSON (page HTML, binaire) : on n'en garde qu'un aperçu. */
const SNIPPET_NON_JSON_MAX = 300;

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

  /**
   * Extrait le message d'erreur d'une réponse amont.
   *
   * POURQUOI CE N'EST PLUS UNE TRONCATURE À 200 CARACTÈRES (2026-08-20).
   * Pendant toute une journée, chaque échec QuickBooks est arrivé illisible :
   * « Request has invalid or unsupported prope… ». Le `Detail` de QuickBooks —
   * la seule partie qui NOMME la propriété refusée — tombait toujours
   * au-delà de la coupure. Des créations d'articles et des ajustements
   * d'inventaire ont été réessayés à l'aveugle sur un dossier de production,
   * avec deux structures de données différentes, sans jamais pouvoir lire ce
   * que QuickBooks reprochait. Le plafond de 200 caractères a coûté plus cher
   * que tous les bugs qu'il protégeait.
   *
   * LA DISTINCTION QUI COMPTE : un message d'erreur DÉLIBÉRÉ (la réponse JSON
   * de marc-andre-app, champ `error`) mérite d'être transmis en entier. Un
   * blob ACCIDENTEL (page d'erreur HTML de Vercel, dump binaire) mérite le
   * plafond serré d'origine — c'était le vrai risque, et il reste couvert.
   */
  private safeSnippet(raw: string): string {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const message =
        typeof parsed?.error === 'string'
          ? parsed.error
          : typeof parsed?.message === 'string'
            ? parsed.message
            : null;
      if (message) {
        // Généreux mais borné : un Fault QuickBooks complet tient largement
        // ici, un registre entier n'y tiendrait pas.
        return message.length > MESSAGE_ERREUR_MAX
          ? message.slice(0, MESSAGE_ERREUR_MAX) + '… (message tronqué)'
          : message;
      }
      // JSON structuré sans champ `error` reconnu : on le rend tel quel, borné.
      return raw.length > MESSAGE_ERREUR_MAX ? raw.slice(0, MESSAGE_ERREUR_MAX) + '… (tronqué)' : raw;
    } catch {
      // Pas du JSON : page HTML, dump binaire… c'est le cas que le plafond
      // serré protégeait, et il continue de le protéger.
      return raw.length > SNIPPET_NON_JSON_MAX ? raw.slice(0, SNIPPET_NON_JSON_MAX) + '…' : raw;
    }
  }
}
