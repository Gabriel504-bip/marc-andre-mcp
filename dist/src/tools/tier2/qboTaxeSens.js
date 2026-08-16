import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Bascule EN LOT du CÔTÉ DU REGISTRE — mandat 2026-08-16.
 *
 * Mesure décisive : le dépôt 237, traité avant que `TaxApplicableOn` soit
 * posé, porte « Purchase » avec les taux d'achat ; le dépôt 156, traité
 * après, porte « Sales » avec les taux de vente. QuickBooks n'impose donc
 * rien sur les dépôts — c'était bien le champ manquant.
 *
 * Pourquoi un outil dédié plutôt qu'inverser puis réappliquer : les montants
 * sont DÉJÀ corrects (base + taxe = montant bancaire). Les retoucher
 * rouvrirait la porte au re-basage qui a fait tomber un dépôt de 145,00 $ à
 * 109,69 $. Ici AUCUN montant n'est réécrit — seul le côté change, donc aucun
 * appariement bancaire n'est menacé.
 */
const confirmationTolerante = z.preprocess((v) => {
    if (v === true)
        return true;
    if (typeof v === 'string' && v.trim().toLowerCase() === 'true')
        return true;
    return false;
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
const qboTaxeLotCorrigerSensInput = z.object({
    sessionToken,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Début de la période, AAAA-MM-JJ (inclus).'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fin de la période, AAAA-MM-JJ (inclus).'),
    typeTransaction: z.enum(['deposit', 'purchase', 'journalentry']).default('deposit'),
    sensTaxe: z
        .enum(['ventes', 'achats'])
        .default('ventes')
        .describe('Côté visé : « ventes » (TaxApplicableOn: Sales, taxe PERÇUE — le cas des revenus) ou ' +
        '« achats » (Purchase, taxe PAYÉE).'),
    taille: nombreTolerant.default(100).describe('Nombre maximum de transactions par appel (1 à 100).'),
    confirmation: confirmationTolerante
        .default(false)
        .describe("FAUX (défaut) = aperçu : compte celles du mauvais côté et celles déjà correctes, sans rien " +
        'modifier. VRAI bascule RÉELLEMENT le lot.'),
});
export const qboTaxeLotCorrigerSens = {
    name: 'ma_qbo_taxe_lot_corriger_sens',
    tier: 2,
    description: 'Bascule EN LOT le CÔTÉ DU REGISTRE des transactions déjà taxées : fait passer leur taxe de ' +
        '« payée sur les achats » à « perçue sur les ventes » (ou l\'inverse). À utiliser quand les ' +
        'montants sont déjà bons mais que la taxe est déclarée du mauvais côté — elle ne remonte alors ' +
        'pas dans la TPS/TVQ perçue, alors que les totaux paraissent corrects. ⚠️ AUCUN MONTANT ' +
        "n'est réécrit : seul TaxApplicableOn change, donc aucun appariement bancaire n'est menacé. " +
        'APERÇU PAR DÉFAUT. Vérifie après écriture que le total n\'a pas bougé ET que le côté a ' +
        'réellement été appliqué (une bascule ignorée en silence serait pire qu\'un échec franc). ' +
        "Reprenable : rappelle jusqu'à `resteACorriger: 0`, une transaction déjà du bon côté n'est " +
        'jamais reprise. Nécessite QBO_WRITE_ENABLED.',
    inputSchema: qboTaxeLotCorrigerSensInput,
    action: 'qbo_taxe_lot_corriger_sens',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2QboTaxeSensTools = [qboTaxeLotCorrigerSens];
