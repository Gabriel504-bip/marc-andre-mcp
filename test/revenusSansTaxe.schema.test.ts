import { describe, it, expect } from 'vitest';
import { qboRevenusSansTaxe } from '../src/tools/tier1/revenusSansTaxe.js';

const base = { sessionToken: 'abcdefgh-1234' };

describe('ma_qbo_revenus_sans_taxe — dates', () => {
  it('accepte une période au format AAAA-MM-JJ', () => {
    const r = qboRevenusSansTaxe.inputSchema.parse({ ...base, from: '2023-06-01', to: '2023-06-30' }) as any;
    expect(r.from).toBe('2023-06-01');
    expect(r.to).toBe('2023-06-30');
  });

  it('refuse un format de date non ISO (le piège JJ/MM/AAAA du CSV ne s\'applique PAS ici)', () => {
    expect(() => qboRevenusSansTaxe.inputSchema.parse({ ...base, from: '01/06/2023', to: '30/06/2023' })).toThrow();
  });

  it('exige les deux bornes', () => {
    expect(() => qboRevenusSansTaxe.inputSchema.parse({ ...base, from: '2023-06-01' })).toThrow();
    expect(() => qboRevenusSansTaxe.inputSchema.parse({ ...base, to: '2023-06-30' })).toThrow();
  });
});

describe('ma_qbo_revenus_sans_taxe — métadonnées', () => {
  it('est en palier 1 (lecture seule, aucun effet)', () => {
    expect(qboRevenusSansTaxe.tier).toBe(1);
  });

  it('la description dit explicitement qu\'il ne modifie rien et qu\'il ne tranche pas', () => {
    expect(qboRevenusSansTaxe.description).toMatch(/LECTURE SEULE/i);
    expect(qboRevenusSansTaxe.description).toMatch(/Ne modifie RIEN/i);
    expect(qboRevenusSansTaxe.description).toMatch(/tranche pas/i);
  });

  it('la description documente le drapeau de troncature', () => {
    expect(qboRevenusSansTaxe.description).toMatch(/tronque/i);
  });
});
