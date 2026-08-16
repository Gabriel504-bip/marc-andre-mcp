import { describe, it, expect } from 'vitest';
import { qboTaxeTransactionModifier } from '../src/tools/tier2/qboTaxeTransaction.js';
/**
 * `ma_qbo_taxe_transaction_modifier` MODIFIE une transaction QuickBooks déjà
 * existante — irréversible. Garde-fou principal : confirmation FAUSSE par
 * défaut, seule la valeur VRAIE explicite écrit (même règle asymétrique que
 * ma_ecriture_manuelle_publier, mais inversée par rapport à `simulation`).
 */
const base = { sessionToken: 'abcdefgh-1234', transactionId: '483' };
const parse = (extra = {}) => qboTaxeTransactionModifier.inputSchema.parse({ ...base, affichageMontants: 'taxe-comprise', ...extra });
describe('ma_qbo_taxe_transaction_modifier — confirmation par défaut', () => {
    it('appel nu => confirmation FAUSSE (aperçu seul)', () => {
        expect(parse().confirmation).toBe(false);
    });
    it('seul true (booléen ou chaîne "true") arme la confirmation', () => {
        expect(parse({ confirmation: true }).confirmation).toBe(true);
        expect(parse({ confirmation: 'true' }).confirmation).toBe(true);
        expect(parse({ confirmation: '  True ' }).confirmation).toBe(true);
    });
    it('toute valeur inattendue retombe du côté SÛR', () => {
        for (const v of [0, 1, 'oui', 'non', null, {}, [], 'nope', false, 'false']) {
            expect(parse({ confirmation: v }).confirmation).toBe(false);
        }
    });
});
describe('ma_qbo_taxe_transaction_modifier — entrées', () => {
    it('transactionId obligatoire et non vide', () => {
        expect(() => qboTaxeTransactionModifier.inputSchema.parse({ sessionToken: base.sessionToken, affichageMontants: 'taxe-comprise' })).toThrow();
        expect(() => qboTaxeTransactionModifier.inputSchema.parse({ ...base, transactionId: '', affichageMontants: 'taxe-comprise' })).toThrow();
    });
    it('typeTransaction vaut deposit par défaut', () => {
        expect(parse().typeTransaction).toBe('deposit');
    });
    it('les trois choix du menu QuickBooks sont acceptés, les autres refusés', () => {
        for (const v of ['taxe-non-comprise', 'taxe-comprise', 'hors-champ']) {
            expect(parse({ affichageMontants: v }).affichageMontants).toBe(v);
        }
        expect(() => parse({ affichageMontants: 'TaxInclusive' })).toThrow();
    });
    it('refuse un type de transaction non supporté', () => {
        expect(() => parse({ typeTransaction: 'invoice' })).toThrow();
    });
});
describe('ma_qbo_taxe_transaction_modifier — métadonnées', () => {
    it('est en palier 2 et porte un délai long (300 s)', () => {
        expect(qboTaxeTransactionModifier.tier).toBe(2);
        expect(qboTaxeTransactionModifier.timeoutMs).toBe(300_000);
    });
    it("la description avertit de l'aperçu par défaut et du risque de dérive du total", () => {
        expect(qboTaxeTransactionModifier.description).toMatch(/APER[ÇC]U PAR D[ÉE]FAUT/i);
        expect(qboTaxeTransactionModifier.description).toMatch(/TOTAL a\s+chang[ée]/i);
    });
});
