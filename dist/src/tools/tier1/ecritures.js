import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { stripRawFields } from '../../format/summarize.js';
import { TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS } from '../types.js';
/** §3.1 outils 4-5. */
export const ecritures = {
    name: 'ma_ecritures',
    tier: 1,
    description: 'Bac de révision (factures, états de compte, relevés) tous clients ou un client précis. ' +
        "⚠️ Si la réponse contient doublonStats.tablesTronquees non vide, le filtre anti-doublon est " +
        "PARTIELLEMENT AVEUGLE sur ces jobs — relaie toujours cet avertissement, ne présente jamais " +
        'la liste comme exhaustive. Le champ `raw` de chaque ligne est retiré par défaut.',
    inputSchema: z.object({
        section: z.enum(['facture', 'etat-de-compte', 'releve']).default('facture').optional(),
        bin: z.enum(['a_reviser', 'archives', 'all']).default('a_reviser').optional(),
        client: z.union([sessionToken, z.literal('all')]).default('all').optional(),
        q: z.string().optional(),
        statut: z.string().optional(),
        compte: z.string().optional(),
        confiance: z.enum(['haute', 'moyenne', 'faible', 'all']).optional(),
        montantMin: z.number().optional(),
        montantMax: z.number().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        factureSens: z.enum(['ventes', 'depenses', 'all']).optional(),
        sortBy: z.enum(['date', 'montant', 'client', 'statut']).optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
        page: z.number().int().min(1).default(1).optional(),
        pageSize: z.number().int().min(1).max(200).default(25).optional(), // plafond volontairement plus bas que les 1000 permis par la route
        inclureRaw: z.boolean().default(false).optional(),
    }),
    action: 'ecritures',
    postProcess: (raw, input) => {
        const lines = Array.isArray(raw?.lines) ? raw.lines : [];
        return {
            ...raw,
            lines: input.inclureRaw ? lines : stripRawFields(lines),
            avertissement: raw?.doublonStats?.tablesTronquees?.length > 0
                ? "⚠️ Filtre anti-doublon partiellement aveugle sur certains jobs — ne pas présenter cette liste comme exhaustive."
                : undefined,
        };
    },
    timeoutMs: TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS,
};
export const statutJob = {
    name: 'ma_statut_job',
    tier: 1,
    description: "Statut d'un job d'analyse QBO. ⚠️ La route sous-jacente peut renvoyer HTTP 200 avec un champ " +
        "`error` renseigné en cas d'échec — ne jamais traiter une réponse 200 comme automatiquement " +
        'réussie, toujours vérifier le champ `error` et le champ `status`. Les résultats détaillés ne ' +
        'sont inclus que si `inclureResultats` est demandé explicitement (compteurs par défaut).',
    inputSchema: z.object({
        sessionToken,
        jobId: z.string(),
        inclureResultats: z.boolean().default(false).optional(),
    }),
    action: 'statut_job',
    postProcess: (raw, input) => {
        if (input.inclureResultats)
            return raw;
        const { results, ...rest } = raw ?? {};
        return {
            ...rest,
            compteurs: results
                ? {
                    ecritures: results.ecritures?.length ?? 0,
                    facturesManquantes: results.facturesManquantes?.length ?? 0,
                    elementsSansJustificatif: results.elementsSansJustificatif?.length ?? 0,
                    observationsControleur: results.observationsControleur?.length ?? 0,
                }
                : undefined,
        };
    },
    timeoutMs: TIMEOUT_LECTURE_DOSSIER_VOLUMINEUX_MS,
};
export const tier1EcrituresTools = [ecritures, statutJob];
