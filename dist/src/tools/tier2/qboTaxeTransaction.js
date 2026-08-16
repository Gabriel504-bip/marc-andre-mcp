import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Modification du TRAITEMENT DE TAXE d'une transaction QuickBooks DÉJÀ
 * existante — mandat 2026-08-15, demande explicite de Gabriel : un dépôt
 * saisi « Hors champ de la taxe » alors que le revenu est taxable doit
 * pouvoir passer en « Taxe comprise » sans ressaisie manuelle.
 *
 * Correspond exactement au menu « Affichage des montants » de l'écran
 * QuickBooks (champ `GlobalTaxCalculation`) :
 *   « Taxe non comprise »   -> taxe-non-comprise  (TaxExcluded)
 *   « Taxe comprise »       -> taxe-comprise      (TaxInclusive)
 *   « Hors champ de la taxe » -> hors-champ       (NotApplicable)
 *
 * SIBLING de `ma_correctifs_appliquer`, qui modifie déjà des transactions
 * existantes (suppression/reclassement) — même palier, même philosophie.
 *
 * Garde-fous :
 *   1. `confirmation` FAUSSE par défaut, forcée après le spread côté
 *      marc-andre-app — seule la valeur booléenne `true` explicite écrit.
 *      Sinon : aperçu qui relit la transaction réelle et montre son état
 *      actuel, sans jamais rien modifier.
 *   2. `QBO_WRITE_ENABLED` (variable Vercel), hors de portée de l'agent.
 *   3. SyncToken relu juste avant l'écriture, puis relecture de vérification.
 *   4. Le TOTAL AVANT et APRÈS est toujours retourné et comparé.
 *      ⚠️ Précédent documenté sur ce dossier (v2.37.1) : « Taxe comprise »
 *      sur QuickBooks Canada avait AJOUTÉ la taxe par-dessus le montant au
 *      lieu de l'en extraire (120,00 $ -> 137,97 $). Si le total change, la
 *      réponse le signale explicitement — à vérifier et annuler au besoin.
 */
/**
 * Même principe que `booleenTolerant`/`decisionsAmbigus` ailleurs dans ce
 * serveur (convention du projet : TOLÉRANT sur la FORME, STRICT sur le FOND).
 * Certains clients MCP sérialisent les nombres en chaîne — refuser « 145 »
 * parce que ce n'est pas 145 bloquerait l'appelant alors que sa valeur est
 * parfaitement valide. Une valeur réellement invalide reste refusée.
 */
const nombreTolerant = z.preprocess((v) => {
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim().replace(',', '.'));
        if (!Number.isNaN(n))
            return n;
    }
    return v;
}, z.number().positive());
const confirmationTolerante = z.preprocess((v) => {
    if (v === true)
        return true;
    if (typeof v === 'string' && v.trim().toLowerCase() === 'true')
        return true;
    return false; // toute valeur inattendue ou absente -> aperçu seul, jamais l'inverse
}, z.boolean());
const qboTaxeTransactionModifierInput = z.object({
    sessionToken,
    transactionId: z
        .string()
        .min(1)
        .describe("Identifiant QuickBooks de la transaction à modifier (l'Id interne, pas le numéro de " +
        'document affiché à l\'écran).'),
    typeTransaction: z
        .enum(['deposit', 'purchase', 'journalentry'])
        .default('deposit')
        .describe("Type de transaction QuickBooks. « deposit » = Dépôt bancaire (cas d'usage principal)."),
    affichageMontants: z
        .enum(['taxe-non-comprise', 'taxe-comprise', 'hors-champ'])
        .optional()
        .describe('Menu « Affichage des montants » de QuickBooks : taxe-non-comprise (TaxExcluded), ' +
        'taxe-comprise (TaxInclusive), hors-champ (NotApplicable). Omettre pour ne pas y toucher.'),
    codeTaxe: z
        .string()
        .optional()
        .describe("Nom EXACT d'un code de taxe QuickBooks (voir ma_qbo_listes_reference, ex. « TPS/TVQ QC - 9,975 ») " +
        'à appliquer sur TOUTES les lignes de la transaction. Omettre pour ne pas y toucher.'),
    montantBanque: nombreTolerant
        .optional()
        .describe("Montant RÉELLEMENT passé au compte bancaire (celui qui est apparié au fil bancaire). Remis " +
        'tel quel dans la ligne de la transaction : QuickBooks en extrait alors lui-même la taxe, ' +
        'donc le total reste égal au montant concilié. Marc André ne calcule AUCUNE taxe. ' +
        "À fournir seulement si le montant d'origine a été perdu par une modification antérieure ; " +
        'sinon la somme des lignes actuelles fait foi.'),
    sensTaxe: z
        .enum(['ventes', 'achats'])
        .optional()
        .describe("Côté du registre où la taxe est déclarée : « ventes » (TaxApplicableOn: Sales, taxe PERÇUE — " +
        "le cas des revenus) ou « achats » (Purchase, taxe PAYÉE). Déduit automatiquement du type des " +
        'comptes touchés si omis : un compte de revenu donne « ventes ». À ne forcer que si la ' +
        'déduction est erronée.'),
    confirmation: confirmationTolerante
        .default(false)
        .describe("FAUX (défaut) = aperçu : relit la transaction réelle et montre son état actuel, rien n'est " +
        'modifié. Mettre VRAI applique RÉELLEMENT la modification dans QuickBooks — à utiliser ' +
        'seulement quand Gabriel le demande explicitement pour cette transaction précise.'),
});
export const qboTaxeTransactionModifier = {
    name: 'ma_qbo_taxe_transaction_modifier',
    tier: 2,
    description: "Modifie le traitement de taxe d'une transaction QuickBooks DÉJÀ EXISTANTE : le menu " +
        "« Affichage des montants » (taxe-non-comprise / taxe-comprise / hors-champ) et/ou le code de " +
        'taxe appliqué à ses lignes, du BON CÔTÉ du registre (ventes ou achats). Cas typique : un ' +
        'dépôt saisi « Hors champ de la taxe » alors que ' +
        'le revenu est taxable. APERÇU PAR DÉFAUT : rien n\'est modifié tant que `confirmation` n\'est ' +
        "pas explicitement VRAI. Relit toujours la transaction avant ET après, et SIGNALE si le TOTAL a " +
        'changé — QuickBooks Canada a déjà, dans un cas documenté, AJOUTÉ la taxe par-dessus le montant ' +
        "au lieu de l'en extraire. Nécessite QBO_WRITE_ENABLED actif côté serveur.",
    inputSchema: qboTaxeTransactionModifierInput,
    action: 'qbo_taxe_transaction_modifier',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2QboTaxeTransactionTools = [qboTaxeTransactionModifier];
