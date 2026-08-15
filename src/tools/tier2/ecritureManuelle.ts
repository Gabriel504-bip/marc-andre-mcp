import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import type { ToolDefinition } from '../types.js';

/**
 * Écriture de journal manuelle libre (agent) — mandat 2026-08-15, demande
 * explicite de Gabriel. Comble un vrai trou : ni `ma_conciliation_exercice_
 * vers_ecritures` (limité aux mouvements d'une conciliation bancaire) ni
 * `ma_correctifs_appliquer` (limité à supprimer/reclasser des écritures déjà
 * existantes) ne permettent de créer une régularisation manuelle libre —
 * ex. une remise DAS fédérale.
 *
 * ⚠️ Contrairement à `ma_conciliation_exercice_vers_ecritures`, cet outil
 * PUBLIE RÉELLEMENT une écriture de journal dans QuickBooks (il ne dépose
 * pas seulement dans le module Écritures pour révision). Deux garde-fous :
 *
 *   1. `simulation` (comme `ma_correctifs_appliquer`) : VRAI par défaut,
 *      forcé après le spread côté marc-andre-app — seule la valeur
 *      booléenne `false` explicite désarme la simulation. Exige en plus
 *      `QBO_WRITE_ENABLED=true` côté serveur (hors de portée de cet outil).
 *   2. `reference` obligatoire : clé d'idempotence. Un rappel avec la même
 *      référence renvoie l'écriture déjà publiée plutôt que d'en créer une
 *      deuxième — indispensable pour un outil qui écrit réellement dans
 *      QuickBooks (contrairement à une simple révision).
 *
 * Ne crée JAMAIS un compte manquant (à la différence du chemin humain
 * « balance de vérification ») : un compte introuvable est un refus
 * explicite — « refuser plutôt que deviner ».
 */

const simulationTolerante = z.preprocess((v) => {
  if (v === false) return false;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'false') return false;
  if (v === true) return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  if (v === undefined) return undefined;
  return true; // valeur inattendue -> on reste en simulation, jamais l'inverse
}, z.boolean());

const ecritureManuelleCreerInput = z.object({
  sessionToken,
  reference: z
    .string()
    .min(1)
    .describe(
      "Identifiant unique fourni par l'appelant (ex. « das-federal-2026-07-entrenous »). " +
        "Sert de clé d'idempotence : un rappel avec la même référence ne crée jamais une " +
        'deuxième écriture — renvoie celle déjà publiée.'
    ),
  csvText: z
    .string()
    .min(1)
    .describe(
      'Contenu TEXTUEL du CSV de l\'écriture (en-tête + lignes), pas un chemin ni du base64. ' +
        'Colonnes : Date;Compte;Débit;Crédit;Description;Memo — une seule date, lignes ' +
        "équilibrées (total débit = total crédit). Chaque nom de compte doit correspondre " +
        'EXACTEMENT à un compte existant du plan comptable QuickBooks du client (voir ' +
        'ma_qbo_listes_reference) — aucun compte manquant ne sera créé.'
    ),
  simulation: simulationTolerante
    .default(true)
    .describe(
      "VRAI (défaut) = aperçu, rien n'est publié dans QuickBooks. Mettre FAUX publie " +
        'réellement l\'écriture de journal — exige aussi QBO_WRITE_ENABLED=true côté ' +
        'marc-andre-app, que cet outil ne contrôle pas.'
    ),
});

export const ecritureManuelleCreer: ToolDefinition = {
  name: 'ma_ecriture_manuelle_creer',
  tier: 2,
  description:
    "Crée une écriture de journal manuelle libre (ex. régularisation DAS fédérale) à partir " +
    "d'un CSV équilibré (Date;Compte;Débit;Crédit;Description;Memo). SIMULATION PAR DÉFAUT : " +
    "aucune écriture QuickBooks n'est touchée tant que `simulation` n'est pas explicitement " +
    'FAUX. `reference` est obligatoire et rend l\'appel idempotent (un rappel avec la même ' +
    "référence renvoie l'écriture déjà publiée). Refuse tout compte absent du plan comptable " +
    'plutôt que d\'en créer un — vérifie l\'orthographe exacte via ma_qbo_listes_reference ' +
    "avant d'appeler cet outil.",
  inputSchema: ecritureManuelleCreerInput,
  action: 'ecriture_manuelle_creer',
};

export const tier2EcritureManuelleTools = [ecritureManuelleCreer];
