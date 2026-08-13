import { z } from 'zod';
import { sessionToken, dateStr } from '../../schemas/common.js';
import { createIntent, consumeIntent } from '../../confirm/intents.js';
import { driveJobToCompletion } from '../../jobs/stepDriver.js';
import { PreconditionError } from '../../core/errors.js';
/**
 * Flux A du §4.3 — analyse QuickBooks. N'écrit RIEN dans QuickBooks : elle
 * consomme de l'API QBO en lecture et produit des propositions. C'est ce
 * qui la rend acceptable en palier 2 (contrairement à l'approbation d'une
 * ligne, qui reste en palier 3, jamais un outil MCP).
 */
const prepareInput = z.object({
    sessionToken,
    from: dateStr,
    to: dateStr,
    options: z
        .object({
        emailFournisseurs: z.boolean().optional(),
        emailClient: z.boolean().optional(),
        emailUtilisateur: z.boolean().optional(),
        destinataireInterne: z.string().optional(),
    })
        .optional(),
});
export const qboAnalysePreparer = {
    name: 'ma_qbo_analyse_preparer',
    tier: 2,
    description: "Étape 1/2 — prépare une analyse QuickBooks pour une période (aucun effet, réversible). " +
        'Retourne un plan + un confirmation_token à usage unique (10 min) à passer à ' +
        'ma_qbo_analyse_executer. Vérifie côté serveur : client existant, QuickBooks connecté, aucun ' +
        'job actif, période ≤ 366 jours.',
    inputSchema: prepareInput,
    action: 'qbo_analyse_preparer',
    postProcess: (raw, input) => ({
        ...raw,
        confirmation_token: createIntent('qbo_analyse', input, input),
    }),
};
export const qboAnalyseExecuter = {
    name: 'ma_qbo_analyse_executer',
    tier: 2,
    description: 'Étape 2/2 — exécute l\'analyse QuickBooks préparée par ma_qbo_analyse_preparer. Exige le ' +
        "confirmation_token exact retourné à l'étape précédente. Cette passerelle pilote elle-même la " +
        "boucle d'étapes (elle remplace le navigateur) — peut prendre plusieurs minutes. Ne retourne " +
        "que les COMPTEURS finaux, jamais le détail complet (voir ma_ecritures pour le détail).",
    inputSchema: z.object({ confirmation_token: z.string() }),
    action: 'qbo_job_start+step (orchestré localement)',
    localHandler: (input, ctx) => runQboAnalyseExecuter(input, ctx),
};
/**
 * Handler spécial (pas un simple postProcess sur un seul appel réseau) :
 * consomme le jeton, démarre le job, puis pilote la boucle /step.
 * Branché explicitement dans registry.ts plutôt que via le mécanisme
 * générique invoke() — voir le commentaire dans registry.ts.
 */
export async function runQboAnalyseExecuter(input, ctx) {
    const params = consumeIntent('qbo_analyse', undefined, input.confirmation_token);
    const startResult = await ctx.http.invoke('qbo_job_start', params, ctx.requestId);
    if (!startResult?.jobId) {
        throw new PreconditionError("marc-andre-app n'a pas retourné de jobId au démarrage.");
    }
    const final = await driveJobToCompletion(ctx.http, 'qbo_job_step', { sessionToken: params.sessionToken, jobId: startResult.jobId }, ctx.requestId, ctx.logger);
    return {
        jobId: startResult.jobId,
        status: final.status,
        compteurs: final.counts,
    };
}
export const qboAnalyseProgression = {
    name: 'ma_qbo_analyse_progression',
    tier: 2,
    description: "Reprend/consulte la progression d'une analyse QBO en cours (utile si la boucle a été " +
        'interrompue par une fermeture de session Cowork ou un redémarrage de la passerelle).',
    inputSchema: z.object({ sessionToken, jobId: z.string() }),
    action: 'statut_job',
};
export const tier2QboTools = [qboAnalysePreparer, qboAnalyseExecuter, qboAnalyseProgression];
