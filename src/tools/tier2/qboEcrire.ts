import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
import type { ToolDefinition } from '../types.js';

/**
 * Écriture GÉNÉRIQUE dans QuickBooks — mandat 2026-08-16, demande de Gabriel :
 * « aucune limite sur l'API ».
 *
 * Aucune limite de CAPACITÉ : créer, modifier ou supprimer n'importe quelle
 * entité QuickBooks. Les deux seuls garde-fous conservés sont exactement ceux
 * qui ont évité les accidents du 2026-08-16, et rien de plus :
 *
 *   1. APERÇU PAR DÉFAUT — l'aperçu a montré 4 671 transactions au lieu de 436
 *      avant une inversion en lot, évitant de détruire la taxe légitime de
 *      plus de 4 200 transactions d'un vrai client.
 *   2. RELECTURE APRÈS ÉCRITURE — c'est elle qui a attrapé la dérive du dépôt
 *      483 (145,00 $ devenu 166,71 $) au moment où elle s'est produite.
 *
 * Le SyncToken est TOUJOURS relu côté serveur, jamais celui fourni par
 * l'appelant : un jeton périmé écraserait une modification faite entre-temps.
 */
const confirmationTolerante = z.preprocess((v) => {
  if (v === true) return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  return false;
}, z.boolean());

export const qboEcrire: ToolDefinition = {
  name: 'ma_qbo_ecrire',
  tier: 2,
  description:
    "Écriture LIBRE dans QuickBooks : crée, modifie ou supprime n'importe quelle entité (Invoice, " +
    'Deposit, JournalEntry, Purchase, Customer, Vendor, Account, Item, CreditMemo...). Aucune limite ' +
    'de capacité — tout ce que QuickBooks accepte est faisable, avec le payload documenté par Intuit. ' +
    '⚠️ APPROBATION HUMAINE OBLIGATOIRE, en deux temps. (1) Appelle SANS `confirmation` : tu obtiens ' +
    "l'état actuel, le payload exact qui partirait, et un `jetonApprobation`. (2) PRÉSENTE cet aperçu " +
    "à Gabriel et ATTENDS son accord explicite — n'utilise JAMAIS le jeton dans le même tour de " +
    "conversation que l'aperçu, l'approbation doit venir de lui, pas de toi. (3) Rappelle alors avec " +
    '`confirmation: true` ET `jetonApprobation`. Sans jeton valide, le serveur refuse (HTTP 428) : le ' +
    "jeton est lié au contenu exact, donc Gabriel approuve précisément ce qui partira, jamais une " +
    "version voisine. Le mémo de chaque transaction écrite porte automatiquement « par l'application " +
    'Marc André » (ajouté au mémo existant, jamais à sa place). Après écriture, l\'objet est RELU et ' +
    'retourné (`etatApres`) — ne jamais se fier à la seule réponse de création. Le SyncToken est ' +
    "toujours relu côté serveur, jamais celui que tu fournis. Nécessite QBO_WRITE_ENABLED. Pour " +
    'lire sans rien modifier, utilise ma_qbo_lire.',
  inputSchema: z.object({
    sessionToken,
    entite: z
      .string()
      .min(1)
      .describe("Type d'entité QuickBooks (ex. « Invoice », « Deposit », « JournalEntry », « Customer »)."),
    operation: z
      .enum(['creer', 'modifier', 'supprimer'])
      .describe("Opération à effectuer. « modifier » et « supprimer » exigent donnees.Id."),
    donnees: z
      .record(z.string(), z.unknown())
      .describe(
        "Objet QuickBooks à envoyer, tel que documenté par Intuit. Pour « modifier »/« supprimer », " +
          'inclure Id (le SyncToken est relu automatiquement, inutile de le fournir).'
      ),
    sparse: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Mise à jour partielle : seuls les champs fournis sont modifiés. FAUX (défaut) remplace ' +
          "l'objet complet — attention, QuickBooks remplace alors le tableau Line en entier."
      ),
    confirmation: confirmationTolerante
      .default(false)
      .describe(
        "FAUX (défaut) = aperçu : relit l'état actuel, montre le payload qui partirait, et retourne " +
          'un `jetonApprobation`. VRAI exécute réellement — mais exige `jetonApprobation`.'
      ),
    jetonApprobation: z
      .string()
      .optional()
      .describe(
        "Jeton retourné par l'aperçu. Obligatoire pour écrire. Il est calculé à partir du contenu " +
          'EXACT : si les données changent, il devient invalide et il faut un nouvel aperçu — donc un ' +
          "nouvel accord de Gabriel. Valable 15 minutes."
      ),
  }),
  action: 'qbo_ecrire',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const tier2QboEcrireTools = [qboEcrire];
