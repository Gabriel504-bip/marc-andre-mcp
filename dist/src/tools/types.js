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
