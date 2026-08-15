import { describe, it, expect } from 'vitest';
import { ecritureManuelleCreer, ecritureManuellePublier } from '../src/tools/tier2/ecritureManuelle.js';
/**
 * `ma_ecriture_manuelle_creer` DÉPOSE dans le module Écritures (jamais
 * directement dans QuickBooks — voir correctif architectural du 2026-08-15
 * dans le fichier source). Ces tests verrouillent les garde-fous : simulation
 * par défaut (même règle asymétrique que ma_correctifs_appliquer), reference
 * obligatoire PAR écriture, et le lot borné à 25.
 *
 * `ma_ecriture_manuelle_publier` (ajouté le même jour, demande explicite de
 * Gabriel) publie RÉELLEMENT dans QuickBooks des écritures déjà déposées par
 * l'outil précédent — garde-fou inverse : confirmation FAUSSE par défaut,
 * seule la valeur VRAIE explicite publie.
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
    it('la description avertit du séparateur virgule, du format de date et de l\'aperçu par défaut', () => {
        expect(ecritureManuelleCreer.description).toMatch(/APER[ÇC]U PAR D[ÉE]FAUT/i);
        expect(ecritureManuelleCreer.description).toMatch(/JJ\/MM\/AAAA/);
        expect(ecritureManuelleCreer.description).toMatch(/VIRGULES/i);
    });
    it("la description est explicite : dépose dans le module Écritures, ne publie JAMAIS directement dans QuickBooks", () => {
        expect(ecritureManuelleCreer.description).toMatch(/MODULE ÉCRITURES/i);
        expect(ecritureManuelleCreer.description).toMatch(/jamais directement dans QuickBooks/i);
    });
});
describe('ma_ecriture_manuelle_publier — confirmation par défaut', () => {
    const parseP = (extra = {}) => ecritureManuellePublier.inputSchema.parse({ ...base, references: ['ref-test'], ...extra });
    it('appel nu => confirmation FAUSSE (aperçu seul)', () => {
        expect(parseP().confirmation).toBe(false);
    });
    it('seul true (booléen ou chaîne "true") arme la confirmation', () => {
        expect(parseP({ confirmation: true }).confirmation).toBe(true);
        expect(parseP({ confirmation: 'true' }).confirmation).toBe(true);
        expect(parseP({ confirmation: '  True ' }).confirmation).toBe(true);
    });
    it('une valeur inattendue retombe du côté SÛR (jamais publiée par accident)', () => {
        for (const v of [0, 1, 'oui', 'non', null, {}, [], 'nope', false, 'false']) {
            expect(parseP({ confirmation: v }).confirmation).toBe(false);
        }
    });
});
describe('ma_ecriture_manuelle_publier — références bornées', () => {
    it('refuse un lot vide', () => {
        expect(() => ecritureManuellePublier.inputSchema.parse({ ...base, references: [] })).toThrow();
    });
    it('accepte jusqu\'à 25 références', () => {
        const refs = Array.from({ length: 25 }, (_, i) => `r${i}`);
        expect(ecritureManuellePublier.inputSchema.parse({ ...base, references: refs }).references).toHaveLength(25);
    });
    it('refuse plus de 25 références', () => {
        const refs = Array.from({ length: 26 }, (_, i) => `r${i}`);
        expect(() => ecritureManuellePublier.inputSchema.parse({ ...base, references: refs })).toThrow();
    });
    it('refuse une référence vide', () => {
        expect(() => ecritureManuellePublier.inputSchema.parse({ ...base, references: [''] })).toThrow();
    });
});
describe('ma_ecriture_manuelle_publier — métadonnées', () => {
    it('est en palier 2 et porte un délai long (300 s)', () => {
        expect(ecritureManuellePublier.tier).toBe(2);
        expect(ecritureManuellePublier.timeoutMs).toBe(300_000);
    });
    it("la description avertit : irréversible, aperçu par défaut, publication réelle dans QuickBooks", () => {
        expect(ecritureManuellePublier.description).toMatch(/IRR[ÉE]VERSIBLE/i);
        expect(ecritureManuellePublier.description).toMatch(/APER[ÇC]U PAR D[ÉE]FAUT/i);
        expect(ecritureManuellePublier.description).toMatch(/PUBLIE R[ÉE]ELLEMENT dans QuickBooks/i);
    });
});
