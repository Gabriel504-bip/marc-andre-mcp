import { describe, it, expect } from 'vitest';
import { ecritureManuelleCreer } from '../src/tools/tier2/ecritureManuelle.js';
/**
 * `ma_ecriture_manuelle_creer` PUBLIE RÉELLEMENT dans QuickBooks (contrairement
 * à ma_conciliation_exercice_vers_ecritures, qui ne fait que déposer dans le
 * module Écritures). Ces tests verrouillent les garde-fous : simulation par
 * défaut (même règle asymétrique que ma_correctifs_appliquer), reference
 * obligatoire PAR écriture, et le lot borné à 25.
 */
const base = { sessionToken: 'abcdefgh-1234' };
const item = (extra = {}) => ({
    reference: 'ref-test',
    csvText: 'Date,Compte,Débit,Crédit\n27/01/2021,Banque,100,0',
    ...extra,
});
const parse = (extra = {}) => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: [item()], ...extra });
describe('ma_ecriture_manuelle_creer — simulation par défaut', () => {
    it('appel nu => SIMULATION', () => {
        expect(parse().simulation).toBe(true);
    });
    it('seul false (booléen ou chaîne "false") désarme la simulation', () => {
        expect(parse({ simulation: false }).simulation).toBe(false);
        expect(parse({ simulation: 'false' }).simulation).toBe(false);
        expect(parse({ simulation: '  False ' }).simulation).toBe(false);
    });
    it("une valeur inattendue retombe du côté SÛR", () => {
        for (const v of [0, 1, 'oui', 'non', null, {}, [], 'nope']) {
            expect(parse({ simulation: v }).simulation).toBe(true);
        }
    });
});
describe('ma_ecriture_manuelle_creer — lot borné', () => {
    it('refuse un lot vide', () => {
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: [] })).toThrow();
    });
    it('accepte jusqu\'à 25 écritures', () => {
        const lot = Array.from({ length: 25 }, (_, i) => item({ reference: `r${i}` }));
        expect(ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: lot }).ecritures).toHaveLength(25);
    });
    it('refuse plus de 25 écritures', () => {
        const lot = Array.from({ length: 26 }, (_, i) => item({ reference: `r${i}` }));
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: lot })).toThrow();
    });
});
describe('ma_ecriture_manuelle_creer — reference obligatoire par écriture', () => {
    it('refuse une écriture sans reference', () => {
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: [item({ reference: '' })] })).toThrow();
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: [{ csvText: item().csvText }] })).toThrow();
    });
    it('accepte une reference non vide', () => {
        expect(parse({ ecritures: [item({ reference: 'das-federal-2026-07-entrenous' })] }).ecritures[0].reference).toBe('das-federal-2026-07-entrenous');
    });
});
describe('ma_ecriture_manuelle_creer — csvText obligatoire par écriture', () => {
    it('refuse un csvText vide ou absent', () => {
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: [item({ csvText: '' })] })).toThrow();
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, ecritures: [{ reference: 'r' }] })).toThrow();
    });
});
describe('ma_ecriture_manuelle_creer — métadonnées', () => {
    it('est en palier 2 et porte un délai long (300 s, pas le défaut 15 s)', () => {
        expect(ecritureManuelleCreer.tier).toBe(2);
        expect(ecritureManuelleCreer.timeoutMs).toBe(300_000);
    });
    it('la description avertit du séparateur virgule, du format de date et de la simulation par défaut', () => {
        expect(ecritureManuelleCreer.description).toMatch(/SIMULATION PAR D[ÉE]FAUT/i);
        expect(ecritureManuelleCreer.description).toMatch(/JJ\/MM\/AAAA/);
        expect(ecritureManuelleCreer.description).toMatch(/VIRGULES/i);
    });
});
