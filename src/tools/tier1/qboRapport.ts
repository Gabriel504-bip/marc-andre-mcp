import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from './conciliation.js';
import type { ToolDefinition } from '../types.js';

/**
 * Rapports QuickBooks — mandat 2026-08-17.
 *
 * Trou constaté par Gabriel : une session n'a pas pu sortir l'état des
 * résultats d'un dossier. `ma_qbo_lire` ne fait que des requêtes SELECT, or
 * les RAPPORTS passent par un point d'entrée totalement différent de l'API
 * (/reports/{type}) auquel le langage de requête ne donne aucun accès.
 *
 * Toute une catégorie de données restait donc murée alors que la capacité
 * existait déjà en interne — exactement le mur que « aucune limite sur
 * l'API » visait à abattre.
 */
export const qboRapport: ToolDefinition = {
  name: 'ma_qbo_rapport',
  tier: 1,
  description:
    "Sort n'importe quel RAPPORT QuickBooks d'un dossier : état des résultats (ProfitAndLoss), bilan " +
    '(BalanceSheet), balance de vérification (TrialBalance), grand livre (GeneralLedger), flux de ' +
    'trésorerie (CashFlow), âge des comptes clients/fournisseurs (AgedReceivables, AgedPayables), ' +
    'sommaire de taxes (TaxSummary), ventes par produit ou par client, journal, liste de transactions, ' +
    "etc. C'est le SEUL moyen d'obtenir ces données : ma_qbo_lire (requêtes SELECT) n'y donne aucun " +
    "accès, les rapports vivant sur un autre point d'entrée de l'API. Lecture seule, aucun effet. " +
    'Les paramètres sont passés tels quels à QuickBooks (start_date, end_date, accounting_method, ' +
    'summarize_column_by, customer, class, department...). Réponse aplatie et lisible par défaut ; ' +
    '`detail: true` pour la structure brute complète.',
  inputSchema: z.object({
    sessionToken,
    rapport: z
      .string()
      .min(1)
      .describe(
        "Nom du rapport QuickBooks. Ex. « ProfitAndLoss » (état des résultats), « BalanceSheet » " +
          '(bilan), « TrialBalance », « GeneralLedger », « TaxSummary », « AgedReceivables », ' +
          '« CashFlow », « JournalReport », « TransactionList », « ItemSales », « CustomerIncome ».'
      ),
    parametres: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional()
      .describe(
        'Paramètres QuickBooks, transmis tels quels. Les plus utiles : start_date et end_date ' +
          '(AAAA-MM-JJ), accounting_method (« Accrual » ou « Cash »), summarize_column_by (« Month », ' +
          '« Quarter », « Year », « Customer », « Class »), customer, class, department, item. ' +
          "Exemple : { start_date: '2023-07-01', end_date: '2024-06-30', summarize_column_by: 'Month' }."
      ),
    detail: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'FAUX (défaut) = rapport aplati et lisible, plafonné à 200 lignes — suffisant pour analyser ' +
          'et ne sature pas la session. VRAI ajoute la structure brute de QuickBooks et monte à ' +
          '2000 lignes : réponse volumineuse, à réserver aux périodes courtes.'
      ),
  }),
  action: 'qbo_rapport',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const tier1QboRapportTools = [qboRapport];
