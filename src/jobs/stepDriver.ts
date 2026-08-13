import { setTimeout as delay } from 'node:timers/promises';
import type { MarcAndreHttpClient } from '../core/httpClient.js';
import type { Logger } from '../core/logger.js';
import { PreconditionError } from '../core/errors.js';

/**
 * Remplace le navigateur pour le patron « job par étapes » de
 * marc-andre-app (qbo-jobs, facturation-jobs). Aujourd'hui, c'est l'onglet
 * ouvert du navigateur qui appelle /step toutes les 2 s ; comme ce serveur
 * MCP est hébergé (décision D9), c'est LUI qui occupe cette place — aucun
 * cron ajouté côté marc-andre-app, aucune modification du moteur existant.
 *
 * Règle non négociable héritée du code source : UNE étape par appel. Ne
 * jamais « optimiser » en enchaînant plusieurs étapes côté serveur avant
 * de revenir — c'est la cause racine de deux 504 déjà documentés dans
 * l'historique du projet (analyzePeriod monolithique).
 */

export interface StepResult {
  status: string;
  done: boolean;
  [key: string]: unknown;
}

export interface StepDriverOptions {
  intervalMs?: number;
  maxIterations?: number;
  maxDurationMs?: number;
  onProgress?: (r: StepResult) => void;
}

export async function driveJobToCompletion(
  http: MarcAndreHttpClient,
  stepTool: string,
  stepInput: unknown,
  requestId: string,
  logger: Logger,
  opts: StepDriverOptions = {}
): Promise<StepResult> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxIterations = opts.maxIterations ?? 300;
  const maxDurationMs = opts.maxDurationMs ?? 20 * 60 * 1000;

  const start = Date.now();
  let lastSeen: string | null = null;
  let stuckCount = 0;

  for (let i = 0; i < maxIterations; i++) {
    if (Date.now() - start > maxDurationMs) {
      throw new PreconditionError(
        `Budget de temps de la passerelle dépassé (${Math.round(
          maxDurationMs / 60000
        )} min). Le job côté marc-andre-app N'EST PAS annulé : il se libérera ` +
          `de lui-même après la période d'inactivité prévue par l'application, ou ` +
          `reprend si la fiche client est ouverte dans le navigateur.`
      );
    }

    const result = await http.invoke<StepResult>(stepTool, stepInput, requestId);
    opts.onProgress?.(result);
    await logger.info('job_step', { stepTool, status: result.status, iteration: i });

    if (result.done) return result;

    // Détection de blocage : même statut renvoyé N fois de suite sans
    // progression — mieux vaut le dire à Claude que de tourner en boucle
    // muette jusqu'au plafond.
    const marker = JSON.stringify({ status: result.status, phase: (result as any).collectPhase ?? (result as any).analysisPhase });
    if (marker === lastSeen) {
      stuckCount++;
      if (stuckCount > 30) {
        // ~1 min sans changement d'état apparent à intervalle 2s
        await logger.warn('job_step_stuck', { stepTool, status: result.status });
      }
    } else {
      stuckCount = 0;
      lastSeen = marker;
    }

    await delay(intervalMs);
  }

  throw new PreconditionError(
    `Le job n'a pas atteint son état final après ${maxIterations} étapes. ` +
      `Utilise l'outil de progression pour vérifier son statut actuel — il continuera ` +
      `d'avancer si la fiche client est ouverte dans marc-andre-app.`
  );
}
