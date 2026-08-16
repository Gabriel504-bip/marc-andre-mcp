import { z } from 'zod';
import { sessionToken, pagination } from '../../schemas/common.js';
import { pickSections } from '../../format/summarize.js';
import { TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS } from '../types.js';
/**
 * §3.1 outils 1-3 du rapport. `ma_chercher_client` est le point d'entrée
 * obligatoire de toute conversation : tout le reste exige un sessionToken,
 * et Gabriel nomme ses clients par leur nom, pas par UUID.
 */
export const chercherClient = {
    name: 'ma_chercher_client',
    tier: 1,
    description: "Recherche un client par nom, courriel ou compagnie (tolère accents/ponctuation partiels). " +
        "TOUJOURS commencer par cet outil : les autres outils exigent un sessionToken, " +
        "que seul celui-ci fournit à partir d'un nom.",
    inputSchema: z.object({
        q: z.string().min(2).describe('Nom, courriel ou compagnie (partiel accepté)'),
        limite: z.number().int().min(1).max(25).default(8).optional(),
    }),
    action: 'chercher_client',
};
export const listerClients = {
    name: 'ma_lister_clients',
    tier: 1,
    description: 'Liste les dossiers clients, paginée. Ne renvoie PAS les threads/onboarding complets ' +
        '(élagués côté passerelle) — utilise ma_fiche_client pour le détail d\'un dossier précis.',
    inputSchema: z.object({
        statut: z.enum(['active', 'complete', 'archived', 'all']).default('active').optional(),
        service: z.string().optional(),
        ...pagination,
    }),
    action: 'lister_clients',
    postProcess: (raw) => {
        const items = Array.isArray(raw?.items) ? raw.items : [];
        return {
            ...raw,
            items: items.map((s) => ({
                sessionToken: s.sessionToken,
                clientName: s.clientName,
                clientEmail: s.clientEmail,
                companyName: s.companyName,
                service: s.service,
                status: s.status,
                docStatus: s.docStatus,
                fileCount: s.fileCount,
                relanceCount: s.relanceCount,
                lastActivity: s.lastActivity,
                quickbooksConnecte: s.quickbooks?.connected ?? false,
                clientUrl: s.clientUrl,
                // threads[], onboardingChecklist et autres champs volumineux
                // sont retirés ici — voir ma_fiche_client pour le détail.
            })),
        };
    },
};
const SECTION_KEYS = {
    identite: ['session'],
    quickbooks: ['quickbooks'],
    docusign: ['docusign'],
    threads: ['threads'],
    mandats: ['mandats', 'demandesMA', 'tenueDeLivre'],
    jobs: ['qboJobs', 'controleurJobs', 'controleurReports'],
    depots: ['depots'],
    registres: ['immobilisations', 'prets'],
};
export const ficheClient = {
    name: 'ma_fiche_client',
    tier: 1,
    description: "Fiche complète d'un client. `sections` est OBLIGATOIRE à préciser (identite, quickbooks, " +
        'docusign, threads, mandats, jobs, depots, registres) — la route sous-jacente fait des appels ' +
        "en direct vers HubSpot/DocuSign/Asana et peut renvoyer une réponse volumineuse (~100 ko) sans " +
        'élagage. Le nom du client affiché est déjà nettoyé en amont (bug historique connu, ne pas ' +
        're-dériver le nom autrement).',
    inputSchema: z.object({
        sessionToken,
        sections: z
            .array(z.enum(['identite', 'quickbooks', 'docusign', 'threads', 'mandats', 'jobs', 'depots', 'registres']))
            .min(1, 'Précise au moins une section — la fiche complète est volumineuse.'),
    }),
    action: 'fiche_client',
    postProcess: (raw, input) => pickSections(raw, input.sections, SECTION_KEYS),
    timeoutMs: TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS,
};
export const tier1ClientTools = [chercherClient, listerClients, ficheClient];
