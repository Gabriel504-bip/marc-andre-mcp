import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
import type { ToolDefinition } from '../types.js';

/**
 * Correctifs en lot par CSV (reclasser / supprimer) — 2026-08-13.
 *
 * ⚠️ AMENDEMENT ASSUMÉ de PALIERS.md. La suppression d'écritures QuickBooks y
 * était classée palier 3 (« jamais un outil MCP exécutable, aucune
 * exception »). Gabriel l'a ouverte en connaissance de cause pour pouvoir
 * déléguer la fermeture d'un exercice. La frontière ne disparaît pas — elle
 * se déplace derrière TROIS verrous, dont deux hors de portée de l'agent :
 *
 *   1. `QBO_WRITE_ENABLED` (variable Vercel de marc-andre-app) — l'agent ne
 *      peut pas la changer. Éteinte, tout appel reste une simulation.
 *   2. `simulation` forcée à VRAI DANS LA PASSERELLE (app/api/agent/invoke),
 *      après le spread de l'entrée, sauf `simulation === false` strictement
 *      booléen. Le garde-fou est côté serveur, pas seulement ici : un client
 *      MCP mal écrit ne peut pas déclencher une suppression par accident.
 *   3. Le défaut du schéma ci-dessous, qui vaut aussi `simulation: true`.
 *
 * Protections déjà en place côté marc-andre-app, inchangées : un chèque de
 * paie est refusé d'office (QuickBooks n'autorise la suppression que du plus
 * récent chèque d'un employé), idempotence par journal, SyncToken relu juste
 * avant chaque écriture, lots de 30 maximum, budget de 240 s.
 */

const correctifsAnalyserInput = z.object({
  sessionToken,
  csvText: z
    .string()
    .min(1)
    .describe(
      'Contenu TEXTUEL du CSV de correctifs (en-tête + lignes), pas un chemin ni du base64. ' +
        'Colonnes : Action;Type;Id;Date;Montant;No document;Compte actuel;Compte cible;Note. ' +
        'Action = supprimer | reclasser.'
    ),
});

/**
 * Booléen tolérant au format (même raison que dans tier1/conciliation.ts :
 * les clients MCP ne sérialisent pas les booléens de la même façon), MAIS
 * avec une asymétrie VOULUE ici : seule la valeur booléenne `false`, ou la
 * chaîne "false" (insensible à la casse et aux espaces autour — c'est le même
 * mot, et tolérer sa forme est précisément le but), désarme la simulation.
 * Toute AUTRE valeur — absente, mal typée, 0, 1, "oui", "non", un objet —
 * laisse la simulation ACTIVE. Sur un outil qui supprime des écritures
 * comptables, l'ambiguïté doit toujours retomber du côté sûr.
 *
 * Piège évité explicitement : `z.coerce.boolean()` aurait transformé la
 * chaîne "false" en TRUE (toute chaîne non vide est truthy en JS) — ici ça
 * aurait ARMÉ l'écriture réelle en croyant la désarmer.
 */
const simulationTolerante = z.preprocess((v) => {
  if (v === false) return false;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'false') return false;
  if (v === true) return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  if (v === undefined) return undefined;
  return true; // valeur inattendue -> on reste en simulation, jamais l'inverse
}, z.boolean());

const correctifsAppliquerInput = z.object({
  sessionToken,
  simulation: simulationTolerante
    .default(true)
    .describe(
      'VRAI (défaut) = simulation, rien n\'est touché dans QuickBooks. Mettre FAUX exécute ' +
        'réellement les suppressions/reclassements — irréversible. Exige aussi QBO_WRITE_ENABLED=true ' +
        'côté marc-andre-app, que cet outil ne contrôle pas.'
    ),
  noLignes: z
    .array(z.number().int().positive())
    .optional()
    .describe(
      'Numéros de ligne du CSV à traiter, pour essayer UNE seule ligne avant de lâcher le lot ' +
        'complet. Omis = toutes les lignes prêtes du plan.'
    ),
  taille: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe('Taille du lot (1 à 30). Omis = valeur par défaut de marc-andre-app.'),
});

export const correctifsAnalyser: ToolDefinition = {
  name: 'ma_correctifs_analyser',
  tier: 2,
  description:
    "Analyse un CSV de correctifs (supprimer / reclasser) : apparie chaque ligne à l'objet " +
    'QuickBooks visé (Id exact, puis type+date+montant+n° de document, puis type+date+montant) et ' +
    "bâtit le plan. LECTURE SEULE côté QuickBooks — ne modifie RIEN. C'est l'étape de diagnostic : " +
    "elle dit précisément pourquoi une ligne ressort « introuvable dans la période lue », " +
    'ambiguë, ou refusée (chèque de paie).',
  inputSchema: correctifsAnalyserInput,
  action: 'correctifs_analyser',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const correctifsAppliquer: ToolDefinition = {
  name: 'ma_correctifs_appliquer',
  tier: 2,
  description:
    'Applique le plan de correctifs bâti par ma_correctifs_analyser. ⚠️ SIMULATION PAR DÉFAUT : ' +
    "aucune écriture QuickBooks n'est touchée tant que `simulation` n'est pas explicitement FAUX. " +
    "L'exécution réelle est IRRÉVERSIBLE (suppression d'écritures) et exige en plus " +
    'QBO_WRITE_ENABLED=true côté serveur. Utilise `noLignes` pour essayer une seule ligne ' +
    "d'abord. Idempotent : une ligne déjà traitée n'est jamais rejouée.",
  inputSchema: correctifsAppliquerInput,
  action: 'correctifs_appliquer',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const tier2CorrectifsTools = [correctifsAnalyser, correctifsAppliquer];
