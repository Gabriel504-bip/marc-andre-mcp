import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
import type { ToolDefinition } from '../types.js';

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
  if (v === false) return false;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'false') return false;
  if (v === true) return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  if (v === undefined) return undefined;
  return true; // valeur inattendue -> on reste en simulation, jamais l'inverse
}, z.boolean());

const ecritureItem = z.object({
  reference: z
    .string()
    .min(1)
    .describe(
      "Identifiant unique de CETTE écriture (ex. « das-federal-2026-07-entrenous »). Clé " +
        "d'idempotence : un rappel avec la même référence ne dépose jamais une deuxième fois."
    ),
  csvText: z
    .string()
    .min(1)
    .describe(
      'CSV séparé par des VIRGULES (pas des points-virgules), UNE seule date pour tout le ' +
        "fichier. En-tête exact : Date,Compte,Débit,Crédit,Description,Memo (Description et Memo " +
        "optionnels mais les 4 premières colonnes obligatoires). Date au format JJ/MM/AAAA (ex. " +
        "27/01/2021) — une date ISO (AAAA-MM-JJ) est ILLISIBLE pour ce parseur. Lignes équilibrées " +
        "(total débit = total crédit) — peut avoir PLUS de 2 comptes (contrairement à une écriture " +
        "de conciliation classique). Chaque nom de compte doit correspondre EXACTEMENT à un compte " +
        "existant du plan comptable QuickBooks du client (voir ma_qbo_listes_reference) — aucun " +
        "compte manquant ne sera créé. Aucune colonne de code de taxe : une écriture de journal " +
        "QuickBooks n'applique de toute façon jamais un code de taxe (limitation QuickBooks/du " +
        "moteur existant, pas de cet outil) — inscris le montant de taxe directement comme une " +
        "ligne débit/crédit sur le bon compte si nécessaire."
    ),
});

const ecritureManuelleCreerInput = z.object({
  sessionToken,
  ecritures: z
    .array(ecritureItem)
    .min(1)
    .max(25)
    .describe(
      "1 à 25 écritures de journal indépendantes par appel. Pour un lot plus grand, découpe en " +
        "plusieurs appels successifs."
    ),
  simulation: simulationTolerante
    .default(true)
    .describe(
      "VRAI (défaut) = aperçu, rien n'est déposé dans le module Écritures. Mettre FAUX dépose " +
        "réellement les écritures dans le module (visibles dans /app/ecritures) — mais ne publie " +
        "JAMAIS dans QuickBooks : seul un humain publie, depuis l'app. S'applique à tout le lot."
    ),
});

export const ecritureManuelleCreer: ToolDefinition = {
  name: 'ma_ecriture_manuelle_creer',
  tier: 2,
  description:
    "Dépose une ou plusieurs écritures de journal manuelles libres (ex. régularisation DAS " +
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

/**
 * Publication RÉELLE, sur demande explicite de Gabriel dans une session,
 * d'écriture(s) DÉJÀ déposée(s) dans le module Écritures par
 * `ma_ecriture_manuelle_creer` — mandat 2026-08-15 (« je dois faire que
 * Claude puisse aussi publier directement dans QuickBook, sur demande »).
 *
 * Amendement ASSUME de PALIERS.md (même précédent que `ma_correctifs_
 * appliquer`) : republie EXACTEMENT la même fonction que le clic humain
 * « Approuver » dans /app/ecritures (publierEcritureManuelleMultiligne,
 * lib/qbo-analysis.js côté marc-andre-app) — même résolution de comptes
 * stricte (refuse un compte manquant plutôt que d'en créer un), même
 * relecture de vérification après création. Aucune nouvelle logique de
 * construction de JournalEntry : zéro divergence possible entre le chemin
 * humain et ce chemin agent.
 *
 * Deux verrous indépendants avant toute écriture réelle dans QuickBooks :
 *   1. `confirmation` : FAUX par défaut, forcé après le spread côté
 *      marc-andre-app — seule la valeur booléenne `true` explicite publie
 *      réellement. Toute autre valeur ne renvoie qu'un aperçu (comptes,
 *      montants, dates de ce qui SERAIT publié), rien n'est touché dans
 *      QuickBooks.
 *   2. QBO_WRITE_ENABLED (variable Vercel), hors de portée de l'agent,
 *      vérifié côté serveur avant toute publication.
 *
 * Idempotent par référence : une référence déjà publiée renvoie son
 * `qboJournalEntryId` existant sans jamais republier. Un échec sur une
 * référence du lot n'interrompt pas les autres.
 */
const confirmationTolerante = z.preprocess((v) => {
  if (v === true) return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  return false; // toute valeur inattendue ou absente -> aperçu seul, jamais l'inverse
}, z.boolean());

const ecritureManuellePublierInput = z.object({
  sessionToken,
  references: z
    .array(z.string().min(1))
    .min(1)
    .max(25)
    .describe(
      "Références (mêmes valeurs que 'reference' passées à ma_ecriture_manuelle_creer) des " +
        "écritures déjà déposées dans le module Écritures, à publier réellement dans QuickBooks. " +
        "1 à 25 par appel."
    ),
  confirmation: confirmationTolerante
    .default(false)
    .describe(
      "FAUX (défaut) = aperçu de ce qui SERAIT publié, rien n'est touché dans QuickBooks. Mettre " +
        "VRAI publie RÉELLEMENT et IRRÉVERSIBLEMENT ces écritures dans QuickBooks — à utiliser " +
        "seulement quand Gabriel le demande explicitement pour ces références précises."
    ),
});

export const ecritureManuellePublier: ToolDefinition = {
  name: 'ma_ecriture_manuelle_publier',
  tier: 2,
  description:
    "Publie RÉELLEMENT dans QuickBooks une ou plusieurs écritures DÉJÀ déposées dans le module " +
    "Écritures via ma_ecriture_manuelle_creer (identifiées par leur `reference`). Republie " +
    "exactement le même mécanisme que le clic humain « Approuver » dans /app/ecritures — même " +
    "validation de comptes, même vérification post-création. IRRÉVERSIBLE et APERÇU PAR DÉFAUT : " +
    "rien n'est publié tant que `confirmation` n'est pas explicitement VRAI. N'utilise ce champ " +
    "VRAI que sur demande explicite de Gabriel pour ces références précises, jamais de ta propre " +
    "initiative. Une référence déjà publiée est renvoyée telle quelle (idempotent, jamais " +
    "republiée). Nécessite QBO_WRITE_ENABLED actif côté serveur (sinon erreur explicite).",
  inputSchema: ecritureManuellePublierInput,
  action: 'ecriture_manuelle_publier',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const tier2EcritureManuelleTools = [ecritureManuelleCreer, ecritureManuellePublier];

