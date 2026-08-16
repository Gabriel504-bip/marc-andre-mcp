import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import type { ToolDefinition } from '../types.js';

/**
 * Rapport EN LECTURE SEULE — mandat 2026-08-16, demande de Gabriel :
 * « identifie toutes les transactions de revenu entre deux dates qui n'ont
 * pas de taxe comprise, ou dont la taxe n'est pas dans la transaction ».
 *
 * Pourquoi un outil dédié plutôt que `ma_qbo_analyse_preparer` : ce dernier
 * est un moteur d'ANALYSE DOCUMENTAIRE (appels Claude, rapprochement de
 * pièces justificatives) — lent, coûteux, et il ne répond pas à cette
 * question. Ici la question est factuelle et se répond par des requêtes
 * QuickBooks en lecture seule.
 *
 * Trois motifs distincts sont rapportés, jamais confondus :
 *   - `hors-champ-de-la-taxe` : GlobalTaxCalculation = NotApplicable ;
 *   - `aucun-code-de-taxe-sur-les-lignes` : aucune ligne ne porte de code ;
 *   - `code-present-mais-taxe-calculee-a-zero` : un code existe mais QuickBooks
 *     n'a calculé aucune taxe (typiquement un code Exonéré/Détaxé).
 *
 * ⚠️ Cet outil NE TRANCHE PAS. Une clinique a de vrais revenus exonérés : le
 * motif dit POURQUOI la taxe est absente, il ne dit pas que c'est une erreur.
 */
const revenusSansTaxeInput = z.object({
  sessionToken,
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Début de la période, au format AAAA-MM-JJ (inclus).'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Fin de la période, au format AAAA-MM-JJ (inclus).'),
});

export const qboRevenusSansTaxe: ToolDefinition = {
  name: 'ma_qbo_revenus_sans_taxe',
  tier: 1,
  description:
    "Rapport EN LECTURE SEULE : liste les transactions de REVENU d'une période qui ne portent AUCUNE " +
    'taxe. Couvre Reçus de vente, Factures, Notes de crédit, Remboursements, et les Dépôts et ' +
    "Écritures de journal touchant un compte de revenu. Les Paiements sont volontairement exclus " +
    '(ils encaissent une facture déjà comptée). Pour chacune, ' +
    'donne le motif précis : « hors-champ-de-la-taxe » (menu Affichage des montants réglé sur Hors ' +
    'champ), « aucun-code-de-taxe-sur-les-lignes », ou « code-present-mais-taxe-calculee-a-zero » ' +
    "(code exonéré/détaxé). Ne modifie RIEN dans QuickBooks. ⚠️ Ne tranche pas : une clinique a de " +
    "vrais revenus exonérés — le motif explique pourquoi la taxe est absente, il ne dit pas que " +
    "c'est une erreur. Si la réponse indique `tronque: true`, la liste est incomplète : découpe la " +
    'période en tranches plus courtes. La réponse contient un bloc `couverture` (types examinés, ' +
    'nombre de transactions LUES par type, nombre sans taxe par type) qui permet de recouper la ' +
    "complétude avec un rapport QuickBooks plutôt que d'avoir à la croire sur parole.",
  inputSchema: revenusSansTaxeInput,
  action: 'qbo_revenus_sans_taxe',
};

export const tier1RevenusSansTaxeTools = [qboRevenusSansTaxe];
