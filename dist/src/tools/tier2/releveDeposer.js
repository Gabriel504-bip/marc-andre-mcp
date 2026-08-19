import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Dépôt d'un relevé bancaire lu en conversation — mandat 2026-08-17.
 *
 * On ne transfère PAS le fichier : on envoie les transactions structurées
 * telles que Claude les a lues. Un relevé PDF dépasse souvent la taille d'un
 * appel MCP, l'extraction serait payée deux fois, et une seconde extraction
 * pourrait donner un résultat différent de ce que Gabriel a sous les yeux.
 *
 * Le garde-fou n'est pas une confirmation humaine mais le CONTRÔLE DE BALANCE :
 * une ligne oubliée et le relevé ne ferme pas, et le moteur nomme le montant
 * manquant. Concilier sur un relevé amputé serait le vrai danger.
 */
const transactionReleve = z.object({
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}/)
        .describe('Date de la transaction, AAAA-MM-JJ.'),
    montant: z
        .union([z.number(), z.string()])
        .describe('Montant TOUJOURS POSITIF. Le sens vient du champ `type`, jamais du signe.'),
    type: z
        .enum(['credit', 'debit'])
        .describe("« credit » = entrée d'argent au compte ; « debit » = sortie."),
    description: z.string().describe('Libellé tel qu\'imprimé sur le relevé, sans reformulation.'),
    soldeApres: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Solde courant imprimé après cette ligne, si le relevé a une colonne de solde. FORTEMENT ' +
        'recommandé : il permet de reconstruire la chaîne des soldes et donc de LOCALISER une ligne ' +
        'manquante, au lieu de seulement constater que le relevé ne ferme pas.'),
});
export const releveDeposer = {
    name: 'ma_releve_deposer',
    tier: 2,
    description: "Dépose dans la session d'un client un relevé bancaire que tu as LU dans la conversation, pour " +
        "pouvoir ensuite concilier et produire les écritures. Tu n'envoies pas le fichier : tu envoies les " +
        'transactions telles que tu les as lues, plus les soldes d\'ouverture et de fermeture imprimés. ' +
        '⚠️ Ces deux soldes sont OBLIGATOIRES car ils servent à VÉRIFIER que ta lecture est complète : le ' +
        'moteur recalcule la balance et reconstruit la chaîne des soldes, et si une seule ligne manque il ' +
        "te dit QUEL montant manque et entre quels soldes il se cache. Ne concilie JAMAIS sur un relevé " +
        'dont la balance ne ferme pas — les écritures produites seraient fausses. Ne touche pas à ' +
        "QuickBooks. Refuse d'écraser un relevé déjà extrait pour cette période sans `remplacer: true` " +
        '(il a peut-être déjà servi à une conciliation).',
    inputSchema: z.object({
        sessionToken,
        periode: z
            .string()
            .regex(/^\d{4}-\d{2}$/)
            .describe('Mois du relevé, AAAA-MM (ex. « 2023-06 »). Un relevé = un mois.'),
        transactions: z
            .array(transactionReleve)
            .min(1)
            .describe('Toutes les lignes du relevé, dans l\'ordre où elles apparaissent.'),
        soldeOuverture: z
            .union([z.number(), z.string()])
            .describe('Solde d\'ouverture imprimé sur le relevé. Obligatoire — sert à valider la complétude.'),
        soldeFermeture: z
            .union([z.number(), z.string()])
            .describe('Solde de fermeture imprimé sur le relevé. Obligatoire — sert à valider la complétude.'),
        compte: z
            .string()
            .optional()
            .describe('Compte bancaire concerné, tel que nommé dans QuickBooks (ex. « Chequing(-952) »).'),
        remplacer: z
            .boolean()
            .default(false)
            .optional()
            .describe('FAUX (défaut) : refuse si un relevé est déjà extrait pour cette période, en indiquant ce ' +
            "qu'il contient. VRAI remplace sciemment — à n'utiliser qu'après avoir vu de quoi il s'agit, " +
            'car une conciliation a peut-être déjà été faite dessus.'),
    }),
    action: 'releve_deposer',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2ReleveDeposerTools = [releveDeposer];
