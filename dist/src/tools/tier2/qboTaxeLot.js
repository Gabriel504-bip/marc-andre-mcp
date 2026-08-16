import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Traitement PAR LOT du code de taxe — mandat 2026-08-16, demande de Gabriel :
 * 433 dépôts à corriger, et l'outil unitaire renvoie un état complet
 * avant/après par appel. La session de l'agent sature bien avant la fin, et le
 * travail reste à moitié fait sans trace propre de ce qui a été traité.
 *
 * Trois propriétés qui rendent ce lot sûr :
 *   1. RÉPONSE COMPACTE — compteurs, identifiants traités, et détail des SEULS
 *      échecs. Jamais l'état complet de chaque transaction.
 *   2. REPRENABLE SANS REGISTRE — rien à maintenir, donc rien à
 *      désynchroniser : une transaction déjà traitée porte le code de taxe, le
 *      balayage ne la retrouve plus. Rappeler l'outil reprend exactement où il
 *      s'est arrêté, même après une coupure, même depuis une autre session.
 *   3. BUDGET DE TEMPS — s'arrête proprement sous la limite de la fonction et
 *      dit combien il reste, au lieu d'être tué en pleine écriture QuickBooks.
 *
 * Exécute EXACTEMENT le même code que `ma_qbo_taxe_transaction_modifier`
 * (cœur partagé côté marc-andre-app) : aucune divergence possible entre le
 * traitement unitaire et le traitement en lot.
 */
const confirmationTolerante = z.preprocess((v) => {
    if (v === true)
        return true;
    if (typeof v === 'string' && v.trim().toLowerCase() === 'true')
        return true;
    return false; // toute valeur inattendue -> aperçu seul, jamais l'inverse
}, z.boolean());
const nombreTolerant = z.preprocess((v) => {
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim().replace(',', '.'));
        if (!Number.isNaN(n))
            return n;
    }
    return v;
}, z.number().int().positive());
const qboTaxeLotAppliquerInput = z.object({
    sessionToken,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Début de la période, AAAA-MM-JJ (inclus).'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fin de la période, AAAA-MM-JJ (inclus).'),
    codeTaxe: z
        .string()
        .min(1)
        .describe("Nom EXACT du code de taxe à appliquer (voir ma_qbo_listes_reference, ex. « TPS/TVQ QC - 9,975 »)."),
    typeTransaction: z
        .enum(['deposit', 'purchase', 'journalentry'])
        .default('deposit')
        .describe('Type de transaction à traiter. « deposit » = Dépôt bancaire.'),
    affichageMontants: z
        .enum(['taxe-non-comprise', 'taxe-comprise', 'hors-champ'])
        .default('taxe-comprise')
        .describe('Menu « Affichage des montants » de QuickBooks à poser sur chaque transaction.'),
    sensTaxe: z
        .enum(['ventes', 'achats'])
        .optional()
        .describe("Côté du registre où la taxe est déclarée : « ventes » (TaxApplicableOn: Sales, taxe PERÇUE — " +
        "le cas des revenus) ou « achats » (Purchase, taxe PAYÉE). Déduit automatiquement du type des " +
        'comptes touchés si omis : un compte de revenu donne « ventes ». À ne forcer que si la ' +
        'déduction est erronée.'),
    taille: nombreTolerant
        .default(100)
        .describe('Nombre maximum de transactions traitées par appel (1 à 100, défaut 100).'),
    confirmation: confirmationTolerante
        .default(false)
        .describe("FAUX (défaut) = aperçu : compte ce qui reste à traiter et montre quelques exemples, sans rien " +
        'modifier. Mettre VRAI traite RÉELLEMENT le lot dans QuickBooks.'),
});
export const qboTaxeLotAppliquer = {
    name: 'ma_qbo_taxe_lot_appliquer',
    tier: 2,
    description: "Applique un code de taxe EN LOT à toutes les transactions de revenu d'une période qui ne l'ont " +
        'pas encore, en préservant le montant bancaire de chacune (QuickBooks calcule la taxe, la base ' +
        'va dans la ligne) et du BON CÔTÉ du registre — par défaut « ventes » (TaxApplicableOn: Sales), ' +
        "puisqu'un dépôt de revenu produit de la taxe PERÇUE. Conçu pour les gros volumes : réponse " +
        'COMPACTE (compteurs + identifiants, ' +
        "jamais l'état complet de chaque transaction) et REPRENABLE — rappelle simplement le même appel " +
        "jusqu'à `resteATraiter: 0`, une transaction déjà traitée n'est jamais reprise, même depuis une " +
        'autre session. APERÇU PAR DÉFAUT : rien n\'est modifié tant que `confirmation` n\'est pas VRAI. ' +
        "S'arrête sous la limite de temps de la fonction et indique combien il reste (`budgetAtteint`). " +
        'Toute transaction dont le TOTAL aurait bougé est listée nommément dans `alertesTotalModifie` — ' +
        "c'est le seul cas qui exige une vérification humaine. Nécessite QBO_WRITE_ENABLED.",
    inputSchema: qboTaxeLotAppliquerInput,
    action: 'qbo_taxe_lot_appliquer',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2QboTaxeLotTools = [qboTaxeLotAppliquer];
