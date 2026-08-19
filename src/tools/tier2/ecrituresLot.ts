import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
import type { ToolDefinition } from '../types.js';

/**
 * Modifier et publier EN LOT les écritures du module — mandat 2026-08-19.
 *
 * Blocage levé : `ma_ecriture_manuelle_publier` ne voit que les écritures
 * créées par `ma_ecriture_manuelle_creer` (source `ecriture-manuelle-agent`).
 * Les écritures issues d'une conciliation d'exercice portent une autre source
 * et restaient donc impubliables depuis une conversation — il fallait ouvrir
 * /app/ecritures à la main.
 *
 * Ces deux outils agissent sur les écritures de TOUTE source, et sélectionnent
 * par CRITÈRES plutôt que par liste d'identifiants : passer 191 lineIds dans
 * une conversation est impraticable.
 *
 * `ma_ecritures_publier_lot` ne réimplémente rien : côté serveur, il rappelle
 * le même chemin que le clic humain « Approuver », ligne par ligne.
 */
const confirmationTolerante = z.preprocess((v) => {
  if (v === true) return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  return false;
}, z.boolean());

const nombreTolerant = z.preprocess((v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    if (!Number.isNaN(n)) return n;
  }
  return v;
}, z.number().int().positive());

const criteres = z
  .object({
    compteCreditActuel: z
      .string()
      .optional()
      .describe('Ne retenir que les lignes dont le compte CRÉDIT vaut exactement ce nom.'),
    compteDebitActuel: z
      .string()
      .optional()
      .describe('Ne retenir que les lignes dont le compte DÉBIT vaut exactement ce nom.'),
    sens: z
      .string()
      .optional()
      .describe("Sens de la ligne tel que stocké (ex. « entree », « sortie », « ventes », « depenses »)."),
    source: z
      .string()
      .optional()
      .describe(
        "Source du job (ex. « conciliation-exercice-ecritures », « ecriture-manuelle-agent »). " +
          'Omettre pour balayer toutes les sources.'
      ),
  })
  .optional()
  .describe(
    'Filtres de sélection. Sans critères, TOUTES les lignes actionnables des jobs prêts pour révision ' +
      "sont visées — fais toujours un aperçu d'abord pour voir combien."
  );

const baseInput = {
  sessionToken,
  criteres,
  lineIds: z
    .array(z.string())
    .optional()
    .describe('Identifiants précis, si tu veux cibler quelques lignes plutôt que des critères.'),
  jobId: z
    .string()
    .optional()
    .describe("Restreindre à un job. Omettre (ou « auto ») pour balayer tous les jobs prêts pour révision."),
  taille: nombreTolerant.default(300).describe('Nombre maximum de lignes traitées par appel (1 à 300).'),
};

export const ecrituresModifierLot: ToolDefinition = {
  name: 'ma_ecritures_modifier_lot',
  tier: 2,
  description:
    'Modifie EN LOT les écritures en attente du module Écritures — typiquement pour reclasser un compte ' +
    'GL avant publication (ex. « Revenu non catégorisé » vers « Services »). Fonctionne sur les écritures ' +
    "de TOUTE source, y compris celles issues d'une conciliation d'exercice. Sélection par CRITÈRES " +
    "(compte actuel, sens, source) : pas besoin de connaître les identifiants. Ne touche PAS à " +
    "QuickBooks — ce sont des brouillons ; la publication se fait avec ma_ecritures_publier_lot. " +
    "APERÇU PAR DÉFAUT : rien n'est modifié tant que `confirmation` n'est pas VRAI, et l'aperçu montre " +
    'combien de lignes correspondent, leur répartition par comptes et le montant total. Ne retouche ' +
    'jamais une ligne déjà publiée.',
  inputSchema: z.object({
    ...baseInput,
    modifications: z
      .record(z.string(), z.unknown())
      .describe(
        'Champs à écrire, ex. { compteCredit: "Services" }. Champs permis : date, description, ' +
          'compteDebit, compteCredit, montant, tps, tvq, cti, rti, note, transactionType, refNumber, ' +
          'payeeName, paymentAccount, taxCode, taxCodeId, classRef, locationRef, memo, lignesDetail.'
      ),
    confirmation: confirmationTolerante
      .default(false)
      .describe("FAUX (défaut) = aperçu. VRAI applique réellement les modifications aux brouillons."),
  }),
  action: 'ecritures_modifier_lot',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const ecrituresPublierLot: ToolDefinition = {
  name: 'ma_ecritures_publier_lot',
  tier: 2,
  description:
    'Publie EN LOT dans QuickBooks les écritures en attente du module Écritures, quelle que soit leur ' +
    "source (conciliation d'exercice incluse) — ce que ma_ecriture_manuelle_publier ne pouvait pas faire. " +
    "Côté serveur, chaque ligne passe par le MÊME chemin que le clic humain « Approuver » : aucune " +
    'logique de publication dupliquée, donc aucune divergence possible. ⚠️ IRRÉVERSIBLE et APERÇU PAR ' +
    "DÉFAUT : rien n'est publié tant que `confirmation` n'est pas VRAI. Demande TOUJOURS l'accord de " +
    "l'utilisateur après lui avoir montré l'aperçu (nombre de lignes, comptes, montant total). Réponse " +
    'compacte et REPRENABLE : rappelle jusqu\'à `resteAPublier: 0`, une ligne déjà publiée n\'est jamais ' +
    "reprise. Les échecs sont détaillés et rejouables, sans retry silencieux. Nécessite QBO_WRITE_ENABLED.",
  inputSchema: z.object({
    ...baseInput,
    confirmation: confirmationTolerante
      .default(false)
      .describe(
        "FAUX (défaut) = aperçu de ce qui SERAIT publié, rien n'est touché dans QuickBooks. VRAI publie " +
          "RÉELLEMENT — à n'utiliser qu'après avoir montré l'aperçu et obtenu un accord explicite."
      ),
  }),
  action: 'ecritures_publier_lot',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const tier2EcrituresLotTools = [ecrituresModifierLot, ecrituresPublierLot];
