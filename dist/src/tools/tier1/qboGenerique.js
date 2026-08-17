import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from './conciliation.js';
/**
 * Accès GÉNÉRIQUE à QuickBooks — mandat 2026-08-16, demande de Gabriel :
 * « aucune limite sur l'API ».
 *
 * Pourquoi c'est justifié : pendant toute une journée, chaque donnée manquante
 * a exigé de construire un outil étroit, de le déployer, puis d'attendre que
 * le connecteur le reprenne. L'information existait déjà côté QuickBooks —
 * seule la passerelle la retenait.
 */
export const qboLire = {
    name: 'ma_qbo_lire',
    tier: 1,
    description: "Lecture LIBRE de QuickBooks : exécute n'importe quelle requête SELECT, ou lit une entité par son " +
        "Id. Remplace le besoin d'un outil dédié par donnée — tout ce que QuickBooks expose est " +
        'accessible (Invoice, Deposit, JournalEntry, Purchase, Customer, Vendor, Account, TaxCode, ' +
        'TaxRate, Item, Payment, CreditMemo, Attachable, Preferences, etc.). Aucun effet possible : ' +
        'seules les requêtes SELECT sont acceptées. Si `tronque: true`, la réponse a été coupée pour ne ' +
        'pas saturer la session — affine la requête (champs précis plutôt que *, ou période plus courte). ' +
        'Exemples : `SELECT * FROM Invoice WHERE TxnDate >= \'2024-01-01\'`, ' +
        "`SELECT Id, Name, AccountType FROM Account`, ou `entite: 'Deposit'` + `entiteId: '483'`.",
    inputSchema: z.object({
        sessionToken,
        requete: z
            .string()
            .optional()
            .describe("Requête QuickBooks (langage SQL-like d'Intuit). Doit commencer par SELECT. MAXRESULTS 1000 " +
            'est ajouté automatiquement si absent, pour ne jamais rapatrier un registre entier par accident.'),
        entite: z
            .string()
            .optional()
            .describe("Type d'entité à lire par Id (ex. « Deposit », « Invoice »). À utiliser avec entiteId."),
        entiteId: z.string().optional().describe("Identifiant QuickBooks de l'entité à lire."),
    }),
    action: 'qbo_lire',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier1QboGeneriqueTools = [qboLire];
