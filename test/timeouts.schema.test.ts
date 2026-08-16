import { describe, it, expect } from 'vitest';
import { buildToolList } from '../src/tools/registry.js';

/**
 * Symptôme réel (2026-08-15, Gabriel) : `ma_ecritures` et `ma_qbo_statut`
 * échouaient systématiquement à EXACTEMENT 15 s sur un dossier volumineux —
 * ce qui ressemblait à un verrou ou à un job bloqué, alors que c'était le
 * délai par défaut du client MCP.
 *
 * Décision du 2026-08-16 (Gabriel) : le défaut passe à 300 s pour TOUTE
 * l'application, aligné sur la durée maximale réelle d'une fonction Vercel
 * Pro côté marc-andre-app. Un client qui abandonne AVANT le serveur est le
 * pire des cas — le travail aboutit et se persiste, mais l'appelant croit à
 * un échec et risque de rejouer l'appel.
 *
 * Ces tests verrouillent les DEUX moitiés de cette décision.
 */
const DEFAUT_ATTENDU_MS = 300_000;

describe('délais réseau', () => {
  const outils = buildToolList({ allowTier2: true } as never);

  it('aucun outil ne PLAFONNE sous le défaut global', () => {
    // Piège concret évité ici : un override par outil REMPLACE le défaut
    // (`opts.timeoutMs ?? config.timeoutMs` dans core/httpClient.ts). Un
    // override plus court que le défaut est donc une RÉGRESSION déguisée en
    // réglage fin — exactement ce qui serait arrivé en laissant les 60 s
    // ajoutés la veille du passage du défaut à 300 s.
    const tropCourts = outils
      .filter((o) => typeof o.timeoutMs === 'number' && o.timeoutMs < DEFAUT_ATTENDU_MS)
      .map((o) => `${o.name} (${o.timeoutMs} ms)`)
      .sort();
    expect(tropCourts).toEqual([]);
  });

  it('les outils qui portent un délai explicite valent exactement le défaut', () => {
    for (const o of outils) {
      if (typeof o.timeoutMs === 'number') expect(o.timeoutMs).toBe(DEFAUT_ATTENDU_MS);
    }
  });

  it('le registre expose bien les outils des deux paliers', () => {
    expect(outils.filter((o) => o.tier === 1).length).toBeGreaterThan(0);
    expect(outils.filter((o) => o.tier === 2).length).toBeGreaterThan(0);
  });
});
