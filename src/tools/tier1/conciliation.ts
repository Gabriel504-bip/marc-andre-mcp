import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { truncateList } from '../../format/summarize.js';
import type { ToolDefinition } from '../types.js';

/**
 * Conciliation d'exercice (relevé bancaire déposé vs registre QuickBooks).
 * Les trois outils de ce fichier sont en LECTURE SEULE côté marc-andre-app —
 * aucun d'eux ne modifie ni le relevé, ni QuickBooks, ni le module Écritures.
 * Seul ma_conciliation_exercice_vers_ecritures (palier 2, tier2/conciliation.ts)
 * a un effet.
 */

/**
 * Paramètres communs aux quatre outils de conciliation d'exercice.
 * `exercice` OU `anneeDebut` doit être fourni (jamais les deux exigés à la
 * fois — un seul suffit à identifier l'exercice du 1er juillet au 30 juin).
 */
export const exerciceInputSchema = z
  .object({
    sessionToken,
    exercice: z
      .string()
      .regex(/^\d{4}-\d{4}$/, 'Format attendu : "AAAA-AAAA" (ex. "2022-2023")')
      .optional()
      .describe('Exercice au format "AAAA-AAAA" (ex. "2022-2023"), du 1er juillet au 30 juin.'),
    anneeDebut: z
      .number()
      .int()
      .optional()
      .describe(
        'Année de début de l\'exercice (ex. 2022 pour l\'exercice 2022-2023) — alternative à exercice.'
      ),
    compte: z
      .string()
      .default('Chequing(-952)')
      .optional()
      .describe('Compte bancaire à concilier.'),
    rechargerQbo: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        "Force un rechargement des données QuickBooks avant la comparaison plutôt que d'utiliser le cache."
      ),
    inclureMoisNonFermes: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Inclut les mois dont la fermeture comptable n\'est pas encore confirmée (par défaut ' +
          'écartés — voir les mois écartés renvoyés avec leur cause).'
      ),
  })
  .refine((v) => !!v.exercice || v.anneeDebut !== undefined, {
    message: 'Précise exercice (ex. "2022-2023") ou anneeDebut (ex. 2022).',
  });

const MAX_ECHANTILLON = 8;

/**
 * Élagage générique : toute liste volumineuse (catégories de lignes,
 * mois détaillés, etc.) est réduite à un échantillon annoncé — jamais un
 * dump complet de centaines de lignes. Les compteurs, la parité et les
 * mois écartés (structures petites) passent tels quels.
 */
export function summarizeConciliation(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;

  const out: Record<string, unknown> = {};
  const troncatures: string[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value) && value.length > MAX_ECHANTILLON) {
      const { items, truncated, totalAvant } = truncateList(value, MAX_ECHANTILLON);
      out[key] = { total: totalAvant, echantillon: items, troncature: truncated };
      troncatures.push(key);
    } else {
      out[key] = value;
    }
  }

  if (troncatures.length > 0) {
    out.avertissementTroncature =
      `Catégories réduites à un échantillon de ${MAX_ECHANTILLON} lignes (${troncatures.join(', ')}) ` +
      '— ce n\'est pas le dump complet. Utilise ma_conciliation_exercice_excel (plan de correction) ' +
      'ou ma_conciliation_exercice_csv (suppressions) pour le détail exhaustif.';
  }

  return out;
}

/**
 * Annonce la taille des champs de type fichier encodé en base64 sans les
 * résumer ni les tronquer — Claude doit recevoir le base64 intact pour le
 * transmettre tel quel, seule la taille affichée est calculée ici.
 */
function annoncerTailleBase64(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;

  const tailles: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 500) {
      const octetsApprox = Math.round((value.length * 3) / 4);
      tailles[key] = `~${(octetsApprox / 1024).toFixed(1)} Ko (base64, non tronqué)`;
    }
  }

  return Object.keys(tailles).length > 0 ? { ...(raw as object), tailleFichiers: tailles } : raw;
}

export const conciliationExercice: ToolDefinition = {
  name: 'ma_conciliation_exercice',
  tier: 1,
  description:
    'Compare le relevé bancaire déposé et le registre QuickBooks pour un exercice complet (1er ' +
    'juillet → 30 juin), avec priorité stricte à la paie et sans jamais deviner en cas ' +
    "d'ambiguïté. Lecture seule. Renvoie les catégories (à supprimer, à ajouter, paie sans " +
    'retrait, ambigus, en attente de décision), la parité en nombre de lignes et en montant, et ' +
    'les mois écartés avec leur cause. ⚠️ Les catégories volumineuses sont réduites à un ' +
    'échantillon — jamais le dump complet (voir avertissementTroncature).',
  inputSchema: exerciceInputSchema,
  action: 'conciliation_exercice',
  postProcess: (raw) => summarizeConciliation(raw),
};

export const conciliationExerciceExcel: ToolDefinition = {
  name: 'ma_conciliation_exercice_excel',
  tier: 1,
  description:
    'Plan de correction en .xlsx (base64) : résumé mois par mois, à supprimer, à ajouter, à ' +
    'corriger, en attente de décision, contrôle. Lecture seule. Le base64 est renvoyé intact ' +
    '(non résumé) — seule sa taille approximative est annoncée.',
  inputSchema: exerciceInputSchema,
  action: 'conciliation_exercice_excel',
  postProcess: (raw) => annoncerTailleBase64(raw),
};

export const conciliationExerciceCsv: ToolDefinition = {
  name: 'ma_conciliation_exercice_csv',
  tier: 1,
  description:
    'CSV des suppressions, prêt pour le panneau « Correctifs en lot par CSV ». Lecture seule, ne ' +
    'supprime rien. Le contenu est renvoyé intact (non résumé) — seule sa taille approximative ' +
    'est annoncée si encodé en base64.',
  inputSchema: exerciceInputSchema,
  action: 'conciliation_exercice_csv',
  postProcess: (raw) => annoncerTailleBase64(raw),
};

export const tier1ConciliationTools = [
  conciliationExercice,
  conciliationExerciceExcel,
  conciliationExerciceCsv,
];
