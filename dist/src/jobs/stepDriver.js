import { setTimeout as delay } from 'node:timers/promises';
import { PreconditionError } from '../core/errors.js';
export async function driveJobToCompletion(http, stepTool, stepInput, requestId, logger, opts = {}) {
    const intervalMs = opts.intervalMs ?? 2000;
    const maxIterations = opts.maxIterations ?? 300;
    const maxDurationMs = opts.maxDurationMs ?? 20 * 60 * 1000;
    const start = Date.now();
    let lastSeen = null;
    let stuckCount = 0;
    for (let i = 0; i < maxIterations; i++) {
        if (Date.now() - start > maxDurationMs) {
            throw new PreconditionError(`Budget de temps de la passerelle dépassé (${Math.round(maxDurationMs / 60000)} min). Le job côté marc-andre-app N'EST PAS annulé : il se libérera ` +
                `de lui-même après la période d'inactivité prévue par l'application, ou ` +
                `reprend si la fiche client est ouverte dans le navigateur.`);
        }
        const result = await http.invoke(stepTool, stepInput, requestId);
        opts.onProgress?.(result);
        await logger.info('job_step', { stepTool, status: result.status, iteration: i });
        if (result.done)
            return result;
        // Détection de blocage : même statut renvoyé N fois de suite sans
        // progression — mieux vaut le dire à Claude que de tourner en boucle
        // muette jusqu'au plafond.
        const marker = JSON.stringify({ status: result.status, phase: result.collectPhase ?? result.analysisPhase });
        if (marker === lastSeen) {
            stuckCount++;
            if (stuckCount > 30) {
                // ~1 min sans changement d'état apparent à intervalle 2s
                await logger.warn('job_step_stuck', { stepTool, status: result.status });
            }
        }
        else {
            stuckCount = 0;
            lastSeen = marker;
        }
        await delay(intervalMs);
    }
    throw new PreconditionError(`Le job n'a pas atteint son état final après ${maxIterations} étapes. ` +
        `Utilise l'outil de progression pour vérifier son statut actuel — il continuera ` +
        `d'avancer si la fiche client est ouverte dans marc-andre-app.`);
}
