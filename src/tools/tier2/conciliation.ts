import { exerciceInputSchema, summarizeConciliation } from '../tier1/conciliation.js';
import type { ToolDefinition } from '../types.js';

/**
 * Seul outil de conciliation qui a un effet : il pousse dans le module
 * Écritures les mouvements à comptabiliser et les régularisations de paie
 * de l'exercice. Reste en palier 2 (et non 3) parce qu'il ne publie RIEN
 * dans QuickBooks — Gabriel poste lui-même depuis le module Écritures ;
 * cet outil ne fait que déposer des lignes à réviser, comme
 * ma_facturation_rapprocher_executer le fait pour la facturation.
 *
 * N'envoie jamais les suppressions (elles passent par le CSV,
 * ma_conciliation_exercice_csv) ni les lignes ambiguës — seules les
 * catégories non ambiguës (mouvements à comptabiliser, régularisations de
 * paie) sont transmises. Idempotent côté marc-andre-app : rejouer le même
 * exercice ne duplique pas ce qui a déjà été envoyé.
 */

export const conciliationExerciceVersEcritures: ToolDefinition = {
  name: 'ma_conciliation_exercice_vers_ecritures',
  tier: 2,
  description:
    'Envoie RÉELLEMENT dans le module Écritures les mouvements à comptabiliser et les ' +
    "régularisations de paie de l'exercice. N'envoie jamais les suppressions (elles passent par " +
    'le CSV, ma_conciliation_exercice_csv) ni les lignes ambiguës. Idempotent, et relit le module ' +
    "après l'envoi pour confirmer ce qui est arrivé. Rien n'est publié dans QuickBooks : Gabriel " +
    'poste lui-même depuis le module Écritures.',
  inputSchema: exerciceInputSchema,
  action: 'conciliation_exercice_vers_ecritures',
  postProcess: (raw) => summarizeConciliation(raw),
};

export const tier2ConciliationTools = [conciliationExerciceVersEcritures];
