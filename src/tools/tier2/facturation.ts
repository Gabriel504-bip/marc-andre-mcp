import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { createIntent, consumeIntent } from '../../confirm/intents.js';
import { driveJobToCompletion } from '../../jobs/stepDriver.js';
import type { ToolContext, ToolDefinition } from '../types.js';

/**
 * Flux B du §4.3 — import de facturation. Déterministe (aucun appel
 * Claude côté marc-andre-app), en deux temps sans rien inventer : la route
 * `facturation-import` le dit déjà explicitement dans son code
 * (« AUCUNE écriture/persistance ici, seulement un aperçu »).
 *
 * Décision D6 non tranchée : ce squelette suppose que les fichiers CSV
 * sont fournis en texte déjà décodé (`content`). Si Gabriel choisit
 * l'option "l'agent lit un fichier local/SharePoint lui-même", il faudra
 * ajouter un module de lecture de fichiers ici — pas encore fait.
 */

const apercuInput = z.object({
  sessionToken,
  fichiers: z
    .array(
      z.object({
        fileName: z.string(),
        content: z.string().describe('Contenu CSV en texte UTF-8 déjà décodé'),
      })
    )
    .min(1)
    .max(12),
});

export const facturationApercu: ToolDefinition = {
  name: 'ma_facturation_apercu',
  tier: 2,
  description:
    "Aperçu d'un import de facturation (max 12 fichiers CSV). AUCUNE persistance à cette étape. " +
    'Retourne un résumé, les conflits détectés, et un confirmation_token pour ' +
    'ma_facturation_rapprocher_executer.',
  inputSchema: apercuInput,
  action: 'facturation_apercu',
  postProcess: (raw: any, input) => ({
    ...raw,
    confirmation_token: createIntent('facturation', input, raw),
  }),
};

export const facturationRapprocherExecuter: ToolDefinition = {
  name: 'ma_facturation_rapprocher_executer',
  tier: 2,
  description:
    "Exécute le rapprochement de facturation préparé par ma_facturation_apercu. Exige le " +
    'confirmation_token exact. Partage le verrou "un seul job actif par client" avec ' +
    "l'analyse QBO — ne peut pas tourner en parallèle sur le même client.",
  inputSchema: z.object({ confirmation_token: z.string() }),
  action: 'facturation_job_start+step (orchestré localement)',
  localHandler: (input, ctx) => runFacturationExecuter(input, ctx),
};

export async function runFacturationExecuter(
  input: { confirmation_token: string },
  ctx: ToolContext
) {
  const apercu = consumeIntent('facturation', undefined, input.confirmation_token) as any;

  const startResult = await ctx.http.invoke<{ jobId: string }>(
    'facturation_job_start',
    { invoices: apercu.invoices, importSummary: apercu.summary },
    ctx.requestId
  );

  const final = await driveJobToCompletion(
    ctx.http,
    'facturation_job_step',
    { jobId: startResult.jobId },
    ctx.requestId,
    ctx.logger
  );

  return { jobId: startResult.jobId, status: final.status, compteurs: (final as any).counts };
}

export const tier2FacturationTools = [facturationApercu, facturationRapprocherExecuter];
