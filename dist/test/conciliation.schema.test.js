import { describe, it, expect } from 'vitest';
import { exerciceInputSchema, conciliationExerciceCsv, conciliationExerciceExcel, conciliationExercice, TIMEOUT_CONCILIATION_LENTE_MS, } from '../src/tools/tier1/conciliation.js';
import { conciliationExerciceVersEcritures } from '../src/tools/tier2/conciliation.js';
/**
 * Régression réelle (2026-08-13, exercice 2022-2023, Clinique Entre-nous) :
 * `decisionsAmbigus` n'était pas déclaré dans le schéma, donc zod l'élaguait
 * EN SILENCE (`.object()` supprime les clés inconnues). Les décisions
 * humaines départageant les ambiguïtés n'atteignaient jamais le moteur, qui
 * répondait `decisionsAppliquees: []` / `nbAmbigusNonResolues: 2` sans aucun
 * message d'erreur. Ces tests verrouillent le contrat : ce qui est transmis
 * DOIT survivre au parse.
 */
const base = { sessionToken: 'abcdefgh-1234', exercice: '2022-2023' };
describe('exerciceInputSchema — champs qui doivent SURVIVRE au parse', () => {
    it('conserve decisionsAmbigus (le bug : il était supprimé en silence)', () => {
        const decisionsAmbigus = [
            { codeReleve: 'R-2223-2304', codeQboRetenu: 'Q-2223-2304' },
            { codeReleve: 'R-2223-2326', codeQboRetenu: 'Q-2223-2326' },
        ];
        const parsed = exerciceInputSchema.parse({ ...base, decisionsAmbigus });
        expect(parsed.decisionsAmbigus).toEqual(decisionsAmbigus);
    });
    it('conserve reparerReleves, sans imposer de défaut (chaque étape a le sien)', () => {
        expect(exerciceInputSchema.parse({ ...base, reparerReleves: true }).reparerReleves).toBe(true);
        expect(exerciceInputSchema.parse({ ...base, reparerReleves: false }).reparerReleves).toBe(false);
        // Omis => absent, donc c'est le défaut de l'étape côté app qui s'applique.
        expect('reparerReleves' in exerciceInputSchema.parse(base)).toBe(false);
    });
    it('refuse une décision incomplète plutôt que de la laisser passer à moitié', () => {
        expect(() => exerciceInputSchema.parse({ ...base, decisionsAmbigus: [{ codeReleve: 'R-2223-2304' }] })).toThrow();
        expect(() => exerciceInputSchema.parse({ ...base, decisionsAmbigus: [{ codeReleve: '', codeQboRetenu: 'Q-1' }] })).toThrow();
        expect(() => exerciceInputSchema.parse({ ...base, decisionsAmbigus: 'R-2223-2304' })).toThrow();
    });
    it('exige toujours exercice ou anneeDebut', () => {
        expect(() => exerciceInputSchema.parse({ sessionToken: 'abcdefgh-1234' })).toThrow();
        expect(() => exerciceInputSchema.parse({ sessionToken: 'abcdefgh-1234', anneeDebut: 2022 })).not.toThrow();
    });
});
describe('timeouts par outil — les étapes lentes ne meurent plus à 15 s', () => {
    it('csv, excel et vers_ecritures ont un délai long', () => {
        expect(conciliationExerciceCsv.timeoutMs).toBe(TIMEOUT_CONCILIATION_LENTE_MS);
        expect(conciliationExerciceExcel.timeoutMs).toBe(TIMEOUT_CONCILIATION_LENTE_MS);
        expect(conciliationExerciceVersEcritures.timeoutMs).toBe(TIMEOUT_CONCILIATION_LENTE_MS);
        expect(TIMEOUT_CONCILIATION_LENTE_MS).toBeGreaterThan(15000);
    });
    it('la lecture pure garde le défaut global (un ralentissement est un signal)', () => {
        expect(conciliationExercice.timeoutMs).toBeUndefined();
    });
    it('les 4 outils partagent le MÊME schéma — un seul endroit à corriger', () => {
        for (const t of [conciliationExercice, conciliationExerciceCsv, conciliationExerciceExcel, conciliationExerciceVersEcritures]) {
            expect(t.inputSchema).toBe(exerciceInputSchema);
        }
    });
});
