import { describe, it, expect } from 'vitest';
import { correctifsAnalyser, correctifsAppliquer } from '../src/tools/tier2/correctifs.js';

/**
 * L'enjeu de ces tests n'est pas cosmétique : `ma_correctifs_appliquer`
 * SUPPRIME des écritures comptables. La règle qu'ils verrouillent est
 * asymétrique et volontaire — toute valeur douteuse doit laisser la
 * SIMULATION active, jamais l'armer.
 */
const base = { sessionToken: 'abcdefgh-1234' };
const parseApp = (extra: Record<string, unknown> = {}) =>
  correctifsAppliquer.inputSchema.parse({ ...base, ...extra }) as any;

describe('ma_correctifs_appliquer — la simulation est le défaut, et le reste', () => {
  it('appel nu => SIMULATION', () => {
    expect(parseApp().simulation).toBe(true);
  });

  it('seul false (booléen ou chaîne "false") désarme la simulation', () => {
    expect(parseApp({ simulation: false }).simulation).toBe(false);
    expect(parseApp({ simulation: 'false' }).simulation).toBe(false);
    expect(parseApp({ simulation: 'FALSE' }).simulation).toBe(false);
    // Espaces autour tolérés : c'est le même mot. Le commentaire du schéma le
    // dit explicitement — code et documentation alignés.
    expect(parseApp({ simulation: '  false  ' }).simulation).toBe(false);
    expect(parseApp({ simulation: 'False ' }).simulation).toBe(false);
  });

  it('true reste true', () => {
    expect(parseApp({ simulation: true }).simulation).toBe(true);
    expect(parseApp({ simulation: 'true' }).simulation).toBe(true);
  });

  it("une valeur inattendue retombe du côté SÛR (piège de z.coerce.boolean, qui aurait rendu 'false' truthy)", () => {
    for (const v of [0, 1, 'oui', 'non', 'peut-etre', null, {}, [], 'falsy', 'nope']) {
      expect(parseApp({ simulation: v as unknown }).simulation).toBe(true);
    }
  });

  it('noLignes permet un essai sur une seule ligne, et refuse les valeurs absurdes', () => {
    expect(parseApp({ noLignes: [4] }).noLignes).toEqual([4]);
    expect(() => parseApp({ noLignes: [0] })).toThrow();
    expect(() => parseApp({ noLignes: [-2] })).toThrow();
    expect(() => parseApp({ noLignes: ['4'] })).toThrow();
  });

  it('taille bornée à 30 (protection contre un lot ingérable)', () => {
    expect(parseApp({ taille: 30 }).taille).toBe(30);
    expect(() => parseApp({ taille: 31 })).toThrow();
    expect(() => parseApp({ taille: 0 })).toThrow();
  });
});

describe('ma_correctifs_analyser — diagnostic, lecture seule', () => {
  it('exige un csvText non vide', () => {
    expect(() => correctifsAnalyser.inputSchema.parse({ ...base })).toThrow();
    expect(() => correctifsAnalyser.inputSchema.parse({ ...base, csvText: '' })).toThrow();
    expect(() =>
      correctifsAnalyser.inputSchema.parse({ ...base, csvText: 'Action;Type;Id\nsupprimer;Dépense;1' })
    ).not.toThrow();
  });

  it('les deux outils sont en palier 2 et portent un délai long', () => {
    for (const t of [correctifsAnalyser, correctifsAppliquer]) {
      expect(t.tier).toBe(2);
      expect(t.timeoutMs).toBeGreaterThan(15000);
    }
  });

  it("la description d'appliquer AVERTIT que c'est irréversible", () => {
    expect(correctifsAppliquer.description).toMatch(/IRR[ÉE]VERSIBLE/i);
    expect(correctifsAppliquer.description).toMatch(/SIMULATION PAR D[ÉE]FAUT/i);
  });
});
