import type { z } from 'zod';
import type { MarcAndreHttpClient } from '../core/httpClient.js';
import type { Logger } from '../core/logger.js';
import type { Config } from '../config.js';

export interface ToolContext {
  http: MarcAndreHttpClient;
  logger: Logger;
  config: Config;
  requestId: string;
}

/**
 * Une entrée de l'allowlist. `action` est le nom d'action attendu par la
 * façade /api/agent/invoke côté marc-andre-app — délibérément distinct du
 * nom d'outil MCP (préfixé `ma_`), pour que renommer un outil côté Claude
 * n'oblige jamais à toucher au contrat serveur.
 *
 * `postProcess` fait l'élagage (raw, troncature annoncée, avertissements)
 * une fois la réponse reçue — jamais côté marc-andre-app, qui renvoie ses
 * contrats existants tels quels.
 */
export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  tier: 1 | 2;
  requiresAdmin?: boolean; // documente que la route sous-jacente est en requireAdmin (info seulement)
  description: string;
  inputSchema: z.ZodType<TInput>;
  action: string;
  postProcess?: (raw: unknown, input: TInput, ctx: ToolContext) => TOutput | Promise<TOutput>;
  /**
   * 🆕 (2026-08-13) — délai réseau PROPRE à cet outil, en millisecondes,
   * quand le défaut global (MA_TIMEOUT_MS, 300 000 ms depuis le 2026-08-16)
   * ne convient pas. Certaines étapes de marc-andre-app dépassent VOLONTAIREMENT
   * 15 s : la conciliation d'exercice relit jusqu'à 2 relevés par appel (un
   * appel IA chacun) avant de produire son CSV, précisément pour ne jamais
   * bâtir un CSV de suppression sur un relevé incomplet.
   *
   * Sans ce champ, ces outils renvoyaient TOUJOURS une erreur de délai alors
   * que le travail s'effectuait et se persistait correctement côté serveur —
   * l'appelant croyait donc à un échec et risquait de rejouer l'appel (ces
   * étapes sont idempotentes, mais l'appelant ne pouvait pas le savoir).
   * Omis = défaut global inchangé.
   */
  timeoutMs?: number;
  /**
   * Pour les outils qui orchestrent PLUSIEURS appels réseau (démarrer un
   * job puis piloter sa boucle /step, consommer un jeton de confirmation
   * avant d'appeler l'action réelle...). Quand présent, remplace le
   * mécanisme générique http.invoke(action, input) + postProcess.
   * `action` reste renseigné pour la documentation, mais n'est pas appelé
   * directement par le registre dans ce cas.
   */
  localHandler?: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

