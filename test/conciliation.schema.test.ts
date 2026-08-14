import { describe, it, expect } from 'vitest';
import {
  exerciceInputSchema,
  conciliationExerciceCsv,
  conciliationExerciceExcel,
  conciliationExercice,
  TIMEOUT_CONCILIATION_LENTE_MS,
} from '../src/tools/tier1/conciliation.js';
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
    expect((parsed as any).decisionsAmbigus).toEqual(decisionsAmbigus);
  });

  it('conserve reparerReleves, sans imposer de défaut (chaque étape a le sien)', () => {
    expect((exerciceInputSchema.parse({ ...base, reparerReleves: true }) as any).reparerReleves).toBe(true);
    expect((exerciceInputSchema.parse({ ...base, reparerReleves: false }) as any).reparerReleves).toBe(false);
    // Omis => absent, donc c'est le défaut de l'étape côté app qui s'applique.
    expect('reparerReleves' in (exerciceInputSchema.parse(base) as any)).toBe(false);
  });

  it('accepte decisionsAmbigus encodé en CHAÎNE (les clients MCP sérialisent différemment)', () => {
    const attendu = [{ codeReleve: 'R-2223-2304', codeQboRetenu: 'Q-2223-2304' }];
    const parsed = exerciceInputSchema.parse({ ...base, decisionsAmbigus: JSON.stringify(attendu) });
    expect((parsed as any).decisionsAmbigus).toEqual(attendu);
  });

  it('accepte reparerReleves en chaîne — et "false" reste FAUX (piège classique de coercition)', () => {
    expect((exerciceInputSchema.parse({ ...base, reparerReleves: 'false' }) as any).reparerReleves).toBe(false);
    expect((exerciceInputSchema.parse({ ...base, reparerReleves: 'true' }) as any).reparerReleves).toBe(true);
    expect((exerciceInputSchema.parse({ ...base, reparerReleves: 'FALSE' }) as any).reparerReleves).toBe(false);
  });

  it('tolérant sur la FORME, strict sur le FOND : une chaîne non-JSON ou un contenu invalide est refusé', () => {
    expect(() => exerciceInputSchema.parse({ ...base, decisionsAmbigus: 'pas du json' })).toThrow();
    expect(() => exerciceInputSchema.parse({ ...base, decisionsAmbigus: '[{"codeReleve":"R-1"}]' })).toThrow();
    expect(() => exerciceInputSchema.parse({ ...base, reparerReleves: 'peut-etre' })).toThrow();
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

  // 🔄 RÉVISÉ (2026-08-14). Ce test affirmait l'inverse : « la lecture pure
  // garde le défaut global (un ralentissement est un signal) ». La décision
  // était défendable, mais elle supposait un cache QBO chaud. À froid,
  // `conciliation_exercice` relit tout le grand livre de l'exercice (3 000+
  // lignes sur le dossier réel) et prend 15 à 60 s.
  //
  // Le 2026-08-14, chaque appel aboutissait côté serveur (HTTP 200 dans les
  // journaux Vercel) mais le MCP raccrochait à 15 s. L'appelant réessayait,
  // chaque tentative relançant une lecture complète -> throttling Microsoft
  // 365 (429) -> écran de connexion cassé. Le garde-fou a coûté plus cher que
  // le ralentissement qu'il signalait.
  //
  // Le signal existe toujours : il est juste placé à 60 s, seuil au-delà
  // duquel c'est une vraie panne (la route côté app est à maxDuration = 60).
  it('la lecture pure a AUSSI un délai long — elle relit le grand livre à froid', () => {
    expect(conciliationExercice.timeoutMs).toBe(TIMEOUT_CONCILIATION_LENTE_MS);
  });

  it('les 4 outils de conciliation partagent le même délai — aucun oublié', () => {
    for (const t of [conciliationExercice, conciliationExerciceCsv, conciliationExerciceExcel, conciliationExerciceVersEcritures]) {
      expect(t.timeoutMs, `${t.name} devrait porter le délai long`).toBe(TIMEOUT_CONCILIATION_LENTE_MS);
    }
  });

  // Aligné sur `maxDuration = 300` de la route côté marc-andre-app, qui est le
  // maximum d'une fonction standard sur le plan Vercel Pro (Gabriel y est
  // passé le 2026-08-14). Sur Hobby, le 300 de la route était plafonné à 60 s
  // en silence — c'est ce qui rendait la conciliation à froid impossible.
  it('le délai est aligné sur maxDuration de la route (300 s, plafond Vercel Pro)', () => {
    expect(TIMEOUT_CONCILIATION_LENTE_MS).toBe(300_000);
    expect(TIMEOUT_CONCILIATION_LENTE_MS).toBeLessThanOrEqual(300_000);
  });

  it('les 4 outils partagent le MÊME schéma — un seul endroit à corriger', () => {
    for (const t of [conciliationExercice, conciliationExerciceCsv, conciliationExerciceExcel, conciliationExerciceVersEcritures]) {
      expect(t.inputSchema).toBe(exerciceInputSchema);
    }
  });
});
