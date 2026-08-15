import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Écriture(s) de journal manuelle(s) libre(s) (agent) — mandat 2026-08-15,
 * demande explicite de Gabriel. Comble un vrai trou : ni `ma_conciliation_
 * exercice_vers_ecritures` (limité aux mouvements d'une conciliation
 * bancaire) ni `ma_correctifs_appliquer` (limité à supprimer/reclasser des
 * écritures déjà existantes) ne permettent de créer une régularisation
 * manuelle libre — ex. une remise DAS fédérale.
 *
 * ⚠️ CORRECTIF (2026-08-15, après 7 essais réels tous en échec — v1 n'a
 * jamais publié une seule écriture) :
 *   - Le CSV est séparé par des VIRGULES (hérité du parseur déjà en
 *     production `parseBalanceCsv`), pas par des points-virgules — la
 *     description précédente contredisait le parseur réel. Corrigé.
 *   - Les dates sont attendues au format JJ/MM/AAAA (ex. 27/01/2021), PAS
 *     ISO (AAAA-MM-JJ) — non documenté avant, corrigé.
 *   - `ecritures` est maintenant un TABLEAU (1 à 25 par appel) : chaque
 *     élément est sa PROPRE écriture de journal indépendante (sa date, son
 *     équilibre débit/crédit, sa référence). Un lot de 231 écritures sur
 *     183 dates se traite donc en ~8 appels plutôt qu'en 183.
 *   - `timeoutMs` allongé à 300 s (comme les autres outils d'écriture) : le
 *     défaut global de 15 s coupait la connexion avant la fin de l'aller-
 *     retour QuickBooks réel, alors que le serveur continuait de travailler.
 *
 * ⚠️ Contrairement à `ma_conciliation_exercice_vers_ecritures`, cet outil
 * PUBLIE RÉELLEMENT une ou plusieurs écritures de journal dans QuickBooks
 * (il ne dépose pas seulement dans le module Écritures pour révision).
 * Deux garde-fous :
 *
 *   1. `simulation` (comme `ma_correctifs_appliquer`) : VRAI par défaut,
 *      forcé après le spread côté marc-andre-app — seule la valeur
 *      booléenne `false` explicite désarme la simulation. Exige en plus
 *      `QBO_WRITE_ENABLED=true` côté serveur (hors de portée de cet outil).
 *   2. `reference` obligatoire PAR écriture : clé d'idempotence. Un rappel
 *      avec la même référence renvoie l'écriture déjà publiée plutôt que
 *      d'en créer une deuxième.
 *
 * Ne crée JAMAIS un compte manquant (à la différence du chemin humain
 * « balance de vérification ») : un compte introuvable est un refus
 * explicite pour CETTE écriture (les autres du lot continuent quand même) —
 * « refuser plutôt que deviner ».
 */
const simulationTolerante = z.preprocess((v) => {
    if (v === false)
        return false;
    if (typeof v === 'string' && v.trim().toLowerCase() === 'false')
        return false;
    if (v === true)
        return true;
    if (typeof v === 'string' && v.trim().toLowerCase() === 'true')
        return true;
    if (v === undefined)
        return undefined;
    return true; // valeur inattendue -> on reste en simulation, jamais l'inverse
}, z.boolean());
const ecritureItem = z.object({
    reference: z
        .string()
        .min(1)
        .describe("Identifiant unique de CETTE écriture (ex. « das-federal-2026-07-entrenous »). Clé " +
        "d'idempotence : un rappel avec la même référence ne crée jamais une deuxième écriture."),
    csvText: z
        .string()
        .min(1)
        .describe('CSV séparé par des VIRGULES (pas des points-virgules), UNE seule date pour tout le ' +
        "fichier. En-tête exact : Date,Compte,Débit,Crédit,Description,Memo (Description et Memo " +
        "optionnels mais les 4 premières colonnes obligatoires, dans cet ordre ou par nom d'en-tête). " +
        "Date au format JJ/MM/AAAA (ex. 27/01/2021) — une date ISO (AAAA-MM-JJ) est ILLISIBLE pour " +
        "ce parseur et fait rejeter la ligne silencieusement. Lignes équilibrées : total débit = " +
        "total crédit. Chaque nom de compte doit correspondre EXACTEMENT à un compte existant du " +
        "plan comptable QuickBooks du client (voir ma_qbo_listes_reference) — aucun compte manquant " +
        "ne sera créé."),
});
const ecritureManuelleCreerInput = z.object({
    sessionToken,
    ecritures: z
        .array(ecritureItem)
        .min(1)
        .max(25)
        .describe("1 à 25 écritures de journal indépendantes par appel (budget de la fonction serveur — " +
        "plusieurs allers-retours QuickBooks par écriture). Pour un lot plus grand, découpe en " +
        "plusieurs appels successifs."),
    simulation: simulationTolerante
        .default(true)
        .describe("VRAI (défaut) = aperçu, rien n'est publié dans QuickBooks. Mettre FAUX publie " +
        'réellement les écritures — exige aussi QBO_WRITE_ENABLED=true côté marc-andre-app, ' +
        'que cet outil ne contrôle pas. S\'applique à TOUT le lot.'),
});
export const ecritureManuelleCreer = {
    name: 'ma_ecriture_manuelle_creer',
    tier: 2,
    description: "Crée une ou plusieurs écritures de journal manuelles libres (ex. régularisation DAS " +
        "fédérale) à partir de CSV équilibrés séparés par des VIRGULES (Date,Compte,Débit,Crédit," +
        "Description,Memo — dates en JJ/MM/AAAA). Jusqu'à 25 écritures indépendantes par appel " +
        "(champ `ecritures`, chacune avec sa propre `reference`). SIMULATION PAR DÉFAUT : aucune " +
        "écriture QuickBooks n'est touchée tant que `simulation` n'est pas explicitement FAUX. " +
        "Chaque écriture a sa PROPRE référence obligatoire (clé d'idempotence — un rappel avec la " +
        "même référence renvoie l'écriture déjà publiée). Refuse tout compte absent du plan " +
        "comptable plutôt que d'en créer un (vérifie l'orthographe exacte via ma_qbo_listes_reference " +
        "avant d'appeler cet outil) — un échec sur une écriture du lot n'empêche jamais le " +
        "traitement des autres, voir le détail par écriture dans `resultats`.",
    inputSchema: ecritureManuelleCreerInput,
    action: 'ecriture_manuelle_creer',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2EcritureManuelleTools = [ecritureManuelleCreer];
