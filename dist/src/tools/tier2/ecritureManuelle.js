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
 * ⚠️ CORRECTIF ARCHITECTURAL (2026-08-15, v2) — la v1 publiait DIRECTEMENT
 * dans QuickBooks (createEntity), sans aucune révision humaine. Deux
 * écritures réelles (18879, 18880) ont été publiées ainsi lors d'un test, et
 * 18880 avait une taxe manquante silencieusement ignorée. Gabriel a tranché :
 * cet outil ne publie plus RIEN dans QuickBooks. Il DÉPOSE les écritures dans
 * le module Écritures (exactement comme `ma_conciliation_exercice_vers_
 * ecritures`) — visibles et modifiables dans /app/ecritures, publiées
 * SEULEMENT par le geste humain qbo-jobs/review action `approve` (palier 3,
 * jamais un outil MCP, voir PALIERS.md).
 *
 * Notes de format (corrigées le même jour après 7 essais réels tous en
 * échec) : le CSV est séparé par des VIRGULES (hérité de parseBalanceCsv,
 * déjà en production), pas des points-virgules. Les dates sont au format
 * JJ/MM/AAAA (ex. 27/01/2021), pas ISO. `ecritures` est un TABLEAU (1 à 25
 * par appel) : chaque élément est sa PROPRE écriture indépendante (sa date,
 * son équilibre débit/crédit, sa référence).
 *
 * Garde-fous :
 *   1. `simulation` : VRAI par défaut, forcé après le spread côté
 *      marc-andre-app — seule la valeur booléenne `false` explicite dépose
 *      réellement dans le module (VRAI = aperçu, rien déposé). Aucune valeur
 *      de `simulation` ne publie jamais dans QuickBooks depuis cet outil.
 *   2. `reference` obligatoire PAR écriture : clé d'idempotence (réutilisée
 *      comme `codeConciliation` côté module — même mécanisme déjà éprouvé
 *      que la conciliation). Un rappel avec la même référence ne dépose
 *      jamais une deuxième fois.
 *
 * Ne crée JAMAIS un compte manquant : un compte introuvable est un refus
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
        "d'idempotence : un rappel avec la même référence ne dépose jamais une deuxième fois."),
    csvText: z
        .string()
        .min(1)
        .describe('CSV séparé par des VIRGULES (pas des points-virgules), UNE seule date pour tout le ' +
        "fichier. En-tête exact : Date,Compte,Débit,Crédit,Description,Memo (Description et Memo " +
        "optionnels mais les 4 premières colonnes obligatoires). Date au format JJ/MM/AAAA (ex. " +
        "27/01/2021) — une date ISO (AAAA-MM-JJ) est ILLISIBLE pour ce parseur. Lignes équilibrées " +
        "(total débit = total crédit) — peut avoir PLUS de 2 comptes (contrairement à une écriture " +
        "de conciliation classique). Chaque nom de compte doit correspondre EXACTEMENT à un compte " +
        "existant du plan comptable QuickBooks du client (voir ma_qbo_listes_reference) — aucun " +
        "compte manquant ne sera créé. Aucune colonne de code de taxe : une écriture de journal " +
        "QuickBooks n'applique de toute façon jamais un code de taxe (limitation QuickBooks/du " +
        "moteur existant, pas de cet outil) — inscris le montant de taxe directement comme une " +
        "ligne débit/crédit sur le bon compte si nécessaire."),
});
const ecritureManuelleCreerInput = z.object({
    sessionToken,
    ecritures: z
        .array(ecritureItem)
        .min(1)
        .max(25)
        .describe("1 à 25 écritures de journal indépendantes par appel. Pour un lot plus grand, découpe en " +
        "plusieurs appels successifs."),
    simulation: simulationTolerante
        .default(true)
        .describe("VRAI (défaut) = aperçu, rien n'est déposé dans le module Écritures. Mettre FAUX dépose " +
        "réellement les écritures dans le module (visibles dans /app/ecritures) — mais ne publie " +
        "JAMAIS dans QuickBooks : seul un humain publie, depuis l'app. S'applique à tout le lot."),
});
export const ecritureManuelleCreer = {
    name: 'ma_ecriture_manuelle_creer',
    tier: 2,
    description: "Dépose une ou plusieurs écritures de journal manuelles libres (ex. régularisation DAS " +
        "fédérale) dans le MODULE ÉCRITURES de marc-andre-app (comme ma_conciliation_exercice_vers_ " +
        "ecritures) — jamais directement dans QuickBooks. CSV séparés par des VIRGULES " +
        "(Date,Compte,Débit,Crédit,Description,Memo — dates en JJ/MM/AAAA), jusqu'à 25 écritures " +
        "indépendantes par appel (champ `ecritures`, chacune avec sa propre `reference`, peut avoir " +
        "plus de 2 comptes). APERÇU PAR DÉFAUT : rien n'est déposé tant que `simulation` n'est pas " +
        "explicitement FAUX. Chaque écriture a sa PROPRE référence obligatoire (idempotence). Refuse " +
        "tout compte absent du plan comptable plutôt que d'en créer un (vérifie l'orthographe exacte " +
        "via ma_qbo_listes_reference avant d'appeler cet outil). Une fois déposées, les écritures sont " +
        "visibles et modifiables par Gabriel dans /app/ecritures — c'est LUI qui les publie dans " +
        "QuickBooks, jamais cet outil.",
    inputSchema: ecritureManuelleCreerInput,
    action: 'ecriture_manuelle_creer',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2EcritureManuelleTools = [ecritureManuelleCreer];
