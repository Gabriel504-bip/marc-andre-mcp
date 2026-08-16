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
   * quand le défaut global (MA_TIMEOUT_MS, 15 000 ms) est structurellement
   * trop court. Certaines étapes de marc-andre-app dépassent VOLONTAIREMENT
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

/**
 * 🆕 (2026-08-16) — délai des LECTURES qui balaient un dossier volumineux.
 *
 * 60 s, pas 300 s : ces routes sont en lecture seule et doivent rester
 * franchement rapides. Le but n'est PAS de tolérer une route lente, c'est
 * d'éviter qu'un cabinet chargé fasse échouer une lecture parfaitement
 * normale à 15 s pile — symptôme observé en production (ma_ecritures et
 * ma_qbo_statut échouant systématiquement à exactement 15 s sur un dossier
 * précis, ce qui ressemblait à tort à un verrou ou à un job bloqué).
 *
 * La vraie correction du volume est côté marc-andre-app (ne plus télécharger
 * le détail des jobs de TOUS les clients quand un seul est demandé) ; cette
 * marge n'est que le filet de sécurité qui va avec.
 */
export const TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS = 60_000;
