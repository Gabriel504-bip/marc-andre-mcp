import { describe, it, expect } from 'vitest';
import { qboInventaireEtat } from '../src/tools/tier1/inventaire.js';
import { qboInventaireAjuster } from '../src/tools/tier2/inventaireAjuster.js';
import { buildToolList } from '../src/tools/registry.js';
const base = { sessionToken: 'abcdefgh-1234' };
const baseAj = {
    ...base,
    date: '2026-06-30',
    compteAjustement: "Écarts d'inventaire",
    ajustements: [{ article: '20 STD CW', nouvelleQuantite: 0 }],
};
describe('ma_qbo_inventaire_etat', () => {
    it('est en palier 1 (lecture seule)', () => {
        expect(qboInventaireEtat.tier).toBe(1);
    });
    it("n'exige rien d'autre que le jeton de session", () => {
        expect(() => qboInventaireEtat.inputSchema.parse({ ...base })).not.toThrow();
    });
    it('dit explicitement qu\'une écriture de journal ne corrige PAS un écart d\'inventaire', () => {
        // C'est la raison d'être de cet outil : sans cet avertissement dans la
        // description, l'agent retombe sur l'écriture de journal, qui déplace
        // l'écart au lieu de le fermer.
        expect(qboInventaireEtat.description).toMatch(/écriture de journal/i);
        expect(qboInventaireEtat.description).toMatch(/ma_qbo_inventaire_ajuster/);
    });
});
describe('ma_qbo_inventaire_ajuster — garde-fous d\'approbation', () => {
    it('est en palier 2 (écrit dans QuickBooks)', () => {
        expect(qboInventaireAjuster.tier).toBe(2);
    });
    it('n\'écrit RIEN par défaut : confirmation vaut false si absente', () => {
        const r = qboInventaireAjuster.inputSchema.parse({ ...baseAj });
        expect(r.confirmation).toBe(false);
    });
    it('traite une confirmation ambiguë comme un refus, jamais comme un accord', () => {
        for (const v of ['oui', 'yes', '1', 'TRUE ', 0, null, undefined, {}]) {
            const r = qboInventaireAjuster.inputSchema.parse({ ...baseAj, confirmation: v });
            if (String(v).trim().toLowerCase() === 'true')
                expect(r.confirmation).toBe(true);
            else
                expect(r.confirmation).toBe(false);
        }
    });
    it('accepte « true » en chaîne (tolérant sur la forme, strict sur le fond)', () => {
        const r = qboInventaireAjuster.inputSchema.parse({ ...baseAj, confirmation: 'true' });
        expect(r.confirmation).toBe(true);
    });
});
describe('ma_qbo_inventaire_ajuster — quantités', () => {
    it('accepte zéro comme quantité visée : ramener un article négatif à 0 est le cas courant', () => {
        const r = qboInventaireAjuster.inputSchema.parse({
            ...baseAj, ajustements: [{ article: 'X', nouvelleQuantite: 0 }],
        });
        expect(r.ajustements[0].nouvelleQuantite).toBe(0);
    });
    it('accepte une variation négative', () => {
        const r = qboInventaireAjuster.inputSchema.parse({
            ...baseAj, ajustements: [{ article: 'X', variationQuantite: -20 }],
        });
        expect(r.ajustements[0].variationQuantite).toBe(-20);
    });
    it('accepte une quantité en chaîne, virgule décimale comprise', () => {
        const r = qboInventaireAjuster.inputSchema.parse({
            ...baseAj, ajustements: [{ article: 'X', nouvelleQuantite: '-3,5' }],
        });
        expect(r.ajustements[0].nouvelleQuantite).toBe(-3.5);
    });
    it('refuse une quantité non numérique plutôt que de la deviner', () => {
        expect(() => qboInventaireAjuster.inputSchema.parse({
            ...baseAj, ajustements: [{ article: 'X', nouvelleQuantite: 'beaucoup' }],
        })).toThrow();
    });
    it('exige un compte de contrepartie — jamais deviné', () => {
        const { compteAjustement, ...sansCompte } = baseAj;
        expect(() => qboInventaireAjuster.inputSchema.parse(sansCompte)).toThrow();
    });
    it('exige une date ISO : une correction de clôture ne doit pas tomber dans le mauvais exercice', () => {
        expect(() => qboInventaireAjuster.inputSchema.parse({ ...baseAj, date: '30/06/2026' })).toThrow();
        expect(() => qboInventaireAjuster.inputSchema.parse({ ...baseAj, date: '2026-06' })).toThrow();
    });
    it('refuse une liste vide et plafonne à 50 lignes', () => {
        expect(() => qboInventaireAjuster.inputSchema.parse({ ...baseAj, ajustements: [] })).toThrow();
        const trop = Array.from({ length: 51 }, () => ({ article: 'X', nouvelleQuantite: 1 }));
        expect(() => qboInventaireAjuster.inputSchema.parse({ ...baseAj, ajustements: trop })).toThrow();
    });
});
describe('ma_qbo_inventaire_ajuster — champ de quantité (entité QBO non documentée)', () => {
    it('utilise QtyDiff par défaut : la seule forme que QuickBooks accepte (mesuré)', () => {
        const r = qboInventaireAjuster.inputSchema.parse({ ...baseAj });
        expect(r.champQuantite).toBe('QtyDiff');
    });
    it('permet de repasser à NewQty si la forme acceptée changeait un jour', () => {
        const r = qboInventaireAjuster.inputSchema.parse({ ...baseAj, champQuantite: 'NewQty' });
        expect(r.champQuantite).toBe('NewQty');
    });
    it('refuse un nom de champ inventé plutôt que de l\'envoyer à QuickBooks', () => {
        expect(() => qboInventaireAjuster.inputSchema.parse({ ...baseAj, champQuantite: 'NewQuantity' })).toThrow();
    });
});
describe('registre', () => {
    it('expose les deux nouveaux outils sous des noms uniques', () => {
        const noms = buildToolList({ allowTier2: true }).map((t) => t.name);
        expect(noms).toContain('ma_qbo_inventaire_etat');
        expect(noms).toContain('ma_qbo_inventaire_ajuster');
        expect(new Set(noms).size).toBe(noms.length);
    });
});
