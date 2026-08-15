import { describe, it, expect } from 'vitest';
import { ecritureManuelleCreer } from '../src/tools/tier2/ecritureManuelle.js';
/**
 * `ma_ecriture_manuelle_creer` PUBLIE RÉELLEMENT dans QuickBooks (contrairement
 * à ma_conciliation_exercice_vers_ecritures, qui ne fait que déposer dans le
 * module Écritures). Ces tests verrouillent les deux garde-fous qui rendent ça
 * acceptable : la simulation par défaut (même règle asymétrique que
 * ma_correctifs_appliquer) et l'obligation d'une référence d'idempotence.
 */
const base = { sessionToken: 'abcdefgh-1234', csvText: 'Date;Compte;Débit;Crédit\n2026-08-01;Banque;100;0' };
const parse = (extra = {}) => ecritureManuelleCreer.inputSchema.parse({ ...base, reference: 'ref-test', ...extra });
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
describe('ma_ecriture_manuelle_creer — reference obligatoire (idempotence)', () => {
    it('refuse un appel sans reference', () => {
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base })).toThrow();
        expect(() => ecritureManuelleCreer.inputSchema.parse({ ...base, reference: '' })).toThrow();
    });
    it('accepte une reference non vide', () => {
        expect(parse({ reference: 'das-federal-2026-07-entrenous' }).reference).toBe('das-federal-2026-07-entrenous');
    });
});
describe('ma_ecriture_manuelle_creer — csvText obligatoire', () => {
    it('refuse un csvText vide ou absent', () => {
        expect(() => ecritureManuelleCreer.inputSchema.parse({ sessionToken: base.sessionToken, reference: 'r' })).toThrow();
        expect(() => ecritureManuelleCreer.inputSchema.parse({ sessionToken: base.sessionToken, reference: 'r', csvText: '' })).toThrow();
    });
});
describe('ma_ecriture_manuelle_creer — métadonnées', () => {
    it('est en palier 2', () => {
        expect(ecritureManuelleCreer.tier).toBe(2);
    });
    it('la description avertit de la publication réelle et de la simulation par défaut', () => {
        expect(ecritureManuelleCreer.description).toMatch(/SIMULATION PAR D[ÉE]FAUT/i);
        expect(ecritureManuelleCreer.description).toMatch(/reference/i);
    });
});
