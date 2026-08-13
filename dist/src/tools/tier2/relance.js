import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { createIntent, consumeIntent } from '../../confirm/intents.js';
import { ConfirmationError } from '../../core/errors.js';
/**
 * Flux C du §4.3 — le SEUL outil du palier 2 qui touche l'extérieur
 * (courriel réel via Resend). Irréversible : un courriel envoyé ne se
 * rappelle pas. Trois garde-fous exigés par le rapport d'architecture,
 * tous implémentés ici :
 *   1. Afficher le destinataire effectif + le mode SAFE_MODE_EMAIL s'il est actif.
 *   2. Anti-doublon : refuser si une relance a déjà été envoyée < 24h.
 *   3. Journaliser AVANT de retourner le succès (pas de fire-and-forget ici).
 */
export const relancePreparer = {
    name: 'ma_relance_preparer',
    tier: 2,
    description: "Prépare une relance client (courriel). AUCUN envoi à cette étape. Affiche toujours le " +
        "destinataire réel et si SAFE_MODE_EMAIL est actif côté marc-andre-app (dans ce cas le " +
        'courriel partira à une adresse de test, jamais au client). Refuse si une relance a déjà été ' +
        'envoyée à ce client dans les 24 dernières heures.',
    inputSchema: z.object({ sessionToken }),
    action: 'relance_preparer',
    postProcess: (raw, input) => {
        const dernieresRelances = raw?.relanceDates ?? [];
        const recente = dernieresRelances.some((d) => Date.now() - new Date(d).getTime() < 24 * 60 * 60 * 1000);
        if (recente) {
            throw new ConfirmationError('Une relance a déjà été envoyée à ce client dans les 24 dernières heures ' +
                '(le cron auto-relance en envoie aussi de son côté — éviter de doubler la voix du cabinet).');
        }
        return {
            ...raw,
            confirmation_token: createIntent('relance', input, input),
        };
    },
};
export const relanceExecuter = {
    name: 'ma_relance_executer',
    tier: 2,
    description: 'Envoie RÉELLEMENT le courriel de relance préparé par ma_relance_preparer (ou à l\'adresse de ' +
        'test si SAFE_MODE_EMAIL est actif côté marc-andre-app). Action irréversible.',
    inputSchema: z.object({ confirmation_token: z.string() }),
    action: 'relance_executer (orchestré localement — journalisation avant retour)',
    localHandler: (input, ctx) => runRelanceExecuter(input, ctx),
};
export async function runRelanceExecuter(input, ctx) {
    const params = consumeIntent('relance', undefined, input.confirmation_token);
    // Journalisation AVANT de retourner le succès — pas de fire-and-forget
    // pour un geste automatisé (contrairement au comportement par défaut
    // de logAction() côté marc-andre-app pour les gestes humains).
    await ctx.logger.info('agent_relance_sent_attempt', { requestId: ctx.requestId });
    const result = await ctx.http.invoke('relance_executer', params, ctx.requestId);
    await ctx.logger.info('agent_relance_sent', { requestId: ctx.requestId, result });
    return result;
}
export const tier2RelanceTools = [relancePreparer, relanceExecuter];
