/** Libellés français alignés sur le vocabulaire déjà utilisé dans marc-andre-app. */
export const STATUT_JOB_FR: Record<string, string> = {
  queued: 'en file d\'attente',
  collecting: 'collecte des données en cours',
  analyzing: 'analyse en cours',
  'ready-for-review': 'prêt pour révision',
  error: 'en erreur',
};

export const DOC_STATUS_FR: Record<string, string> = {
  complet: 'dossier complet',
  archive: 'archivé',
  documents_recus: 'documents reçus',
  en_attente: 'en attente de documents',
  pas_traite: 'pas encore traité',
};

export function labelStatutJob(status: string): string {
  return STATUT_JOB_FR[status] ?? status;
}
