import { z } from 'zod';
import { TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS } from '../types.js';
/**
 * §3.1 outils 8-11. Ces quatre routes sont en `requireAdmin` côté
 * marc-andre-app (pas seulement `requireStaff`) — signal que le projet les
 * considère plus sensibles que le reste du palier 1. On les garde en
 * palier 1 (lecture seule, aucun effet), mais `force` reste désactivé par
 * défaut partout : ces routes tapent lourdement HubSpot/Asana, et un
 * agent qui martèle `force` sur un "rafraîchis-moi ça" innocent est un
 * vrai risque de throttling (décision D12).
 */
export const financeCabinet = {
    name: 'ma_finance',
    tier: 1,
    requiresAdmin: true,
    description: "Tableau de bord financier du cabinet (ARR, deals HubSpot, abonnements). ⚠️ L'ARR est calculé " +
        "à partir des montants récurrents actifs annualisés (pas une projection), et le statut " +
        "\"actif\" vient d'une recherche insensible à la casse sur hs_status, jamais vérifiée contre " +
        "le portail HubSpot lui-même — présente toujours ces chiffres comme des ESTIMATIONS, jamais " +
        "comme de la comptabilité certifiée. `force` n'est jamais transmis sans demande explicite de Gabriel.",
    inputSchema: z.object({
        force: z.boolean().default(false).optional(),
    }),
    action: 'finance',
    timeoutMs: TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS,
};
export const tachesEquipe = {
    name: 'ma_taches_equipe',
    tier: 1,
    requiresAdmin: true,
    description: "Tâches Asana de toute l'équipe (en retard, cette semaine, semaine prochaine) par employé. " +
        "⚠️ Le lien tâche↔client vient d'une heuristique — relaie-le comme un indice, jamais comme un " +
        "fait établi. `force` n'est jamais transmis sans demande explicite de Gabriel (scan complet du " +
        "workspace Asana à chaque appel).",
    inputSchema: z.object({
        force: z.boolean().default(false).optional(),
    }),
    action: 'taches_equipe',
    timeoutMs: TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS,
};
export const journalAudit = {
    name: 'ma_journal_audit',
    tier: 1,
    requiresAdmin: true,
    description: "Journal d'audit d'un mois donné — y compris les actions posées par cet agent lui-même " +
        "(action préfixée agent_). C'est l'outil qui te rend auditable par Gabriel.",
    inputSchema: z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/, 'Format attendu : YYYY-MM'),
        action: z.string().optional(),
        userId: z.string().optional(),
        client: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100).optional(),
        offset: z.number().int().min(0).default(0).optional(),
    }),
    action: 'journal_audit',
};
export const accueilSynthese = {
    name: 'ma_accueil_synthese',
    tier: 1,
    description: "Tuiles de synthèse du cabinet (clients par statut, écritures en attente, tâches en retard, " +
        "missions actives/en échec). Bon premier appel économique pour situer une conversation. " +
        "⚠️ Le compteur de missions est un proxy approximatif assumé côté marc-andre-app.",
    inputSchema: z.object({}),
    action: 'accueil_synthese',
    timeoutMs: TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS,
};
export const tier1AdminTools = [financeCabinet, tachesEquipe, journalAudit, accueilSynthese];
