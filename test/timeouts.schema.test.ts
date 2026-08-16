import { describe, it, expect } from 'vitest';
import { buildToolList } from '../src/tools/registry.js';

/**
 * Symptôme réel (2026-08-15, Gabriel) : `ma_ecritures` et `ma_qbo_statut`
 * échouaient systématiquement à EXACTEMENT 15 s sur un dossier volumineux —
 * ce qui ressemblait à un verrou ou à un job bloqué, alors que c'était le
 * délai par défaut du client MCP (MA_TIMEOUT_MS = 15 000 ms).
 *
 * Ces tests verrouillent le fait que toute LECTURE susceptible de balayer un
 * gros dossier porte un délai explicite. Le défaut de 15 s reste correct pour
 * les appels réellement courts (recherche, listes) — on ne l'augmente pas
 * partout à l'aveugle.
 */
const LECTURES_DE_DOSSIER_VOLUMINEUX = [
  'ma_ecritures',
  'ma_statut_job',
  'ma_qbo_statut',
  'ma_qbo_listes_reference',
  'ma_fiche_client',
  'ma_finance',
  'ma_taches_equipe',
  'ma_accueil_synthese',
];

describe('délais réseau — lectures de dossier volumineux', () => {
  const outils = buildToolList({ allowTier2: true } as never);
  const parNom = new Map(outils.map((o) => [o.name, o]));

  it.each(LECTURES_DE_DOSSIER_VOLUMINEUX)(
    '%s porte un délai explicite (jamais le défaut de 15 s)',
    (nom) => {
      const outil = parNom.get(nom);
      expect(outil, `outil ${nom} absent du registre`).toBeDefined();
      expect(outil!.timeoutMs, `${nom} retomberait sur le défaut de 15 s`).toBeGreaterThan(15_000);
    }
  );

  it('tout outil qui écrit réellement porte aussi un délai explicite', () => {
    const sansDelai = outils
      .filter((o) => o.tier === 2 && !o.timeoutMs)
      .map((o) => o.name)
      .sort();
    // Les outils tier 2 restants sans délai sont des appels courts assumés
    // (préparation, progression) — ce test documente lesquels, pour qu'un
    // ajout futur soit un choix conscient et non un oubli silencieux.
    expect(sansDelai).toEqual([
      'ma_facturation_apercu',
      'ma_facturation_rapprocher_executer',
      'ma_qbo_analyse_executer',
      'ma_qbo_analyse_preparer',
      'ma_qbo_analyse_progression',
      'ma_relance_executer',
      'ma_relance_preparer',
    ]);
  });
});
