import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Inversion EN LOT — mandat 2026-08-16, spec écrite par Gabriel après avoir
 * ARRÊTÉ un traitement qui allait casser 436 appariements bancaires.
 *
 * Le constat qui a motivé cet outil : `ma_qbo_taxe_transaction_modifier` ne
 * sait pas inverser. Quand le code de taxe visé n'a aucun taux, il ne réécrit
 * pas le montant de la ligne — il retire seulement la taxe, et le total tombe
 * mécaniquement (130,00 $ -> 113,07 $).
 *
 * LE POINT CRITIQUE : la réécriture du montant et le retrait du code partent
 * dans le MÊME appel à QuickBooks. Les séparer laisse la transaction dans un
 * état intermédiaire où le total est déjà tombé — c'est exactement ce qui est
 * arrivé au dépôt 156.
 *
 * Montant cible = TOTAL ACTUEL de la transaction, qui vaut le montant bancaire
 * d'origine tant que la taxe y est encore incluse (lignes + taxe). Une
 * transaction déjà dépouillée de sa taxe a perdu cette information : elle
 * n'est PAS traitée et ressort dans `aRepriseManuelle`. On ne devine jamais.
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
const qboTaxeLotInverserInput = z.object({
    sessionToken,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Début de la période, AAAA-MM-JJ (inclus).'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Fin de la période, AAAA-MM-JJ (inclus).'),
    typeTransaction: z
        .enum(['deposit', 'purchase', 'journalentry'])
        .default('deposit')
        .describe('Type de transaction à remettre hors champ.'),
    montantsExplicites: z
        .record(z.string(), z.number().positive())
        .optional()
        .describe("Montants d'origine imposés, par identifiant de transaction : { \"577\": 2931.20 }. À utiliser " +
        "quand le total actuel ne reflète pas exactement le montant bancaire (écarts d'un cent), ou " +
        'pour reprendre une transaction listée dans `aRepriseManuelle`.'),
    taille: nombreTolerant.default(100).describe('Nombre maximum de transactions par appel (1 à 100).'),
    confirmation: confirmationTolerante
        .default(false)
        .describe("FAUX (défaut) = aperçu : compte ce qui reste à inverser, montre des exemples avec le montant " +
        'qui serait remis dans la ligne, et liste les cas à reprise manuelle. Rien n\'est modifié. ' +
        'VRAI inverse RÉELLEMENT le lot.'),
});
export const qboTaxeLotInverser = {
    name: 'ma_qbo_taxe_lot_inverser',
    tier: 2,
    description: "Annule EN LOT l'application d'un code de taxe : remet les transactions « hors champ de la taxe » " +
        'en restaurant leur montant bancaire d\'origine, sans casser les appariements. Sélectionne ' +
        "l'empreinte laissée par ma_qbo_taxe_lot_appliquer (affichage TaxInclusive + code de taxe posé). " +
        'Le montant remis dans la ligne est le TOTAL ACTUEL, qui EST le montant bancaire tant que la taxe ' +
        "y est encore incluse — et la réécriture du montant et le retrait du code partent dans le MÊME " +
        'appel, sans quoi le total tombe. Une transaction déjà dépouillée de sa taxe n\'est PAS traitée ' +
        "et ressort dans `aRepriseManuelle` avec son état : fournis alors son montant via " +
        '`montantsExplicites`. APERÇU PAR DÉFAUT. Reprenable : rappelle jusqu\'à `resteAInverser: 0`, une ' +
        'transaction déjà hors champ n\'est jamais reprise. Nécessite QBO_WRITE_ENABLED.',
    inputSchema: qboTaxeLotInverserInput,
    action: 'qbo_taxe_lot_inverser',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2QboTaxeLotInverserTools = [qboTaxeLotInverser];
