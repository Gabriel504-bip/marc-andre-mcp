import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from '../tier1/conciliation.js';
/**
 * Ajustement des quantités d'inventaire — 2026-08-20, demande de Gabriel :
 * « il faut que Marc André puisse modifier les inventaires ».
 *
 * La capacité existait déjà : ma_qbo_ecrire accepte n'importe quelle entité
 * QuickBooks, InventoryAdjustment comprise. Mais rien ne le disait et la
 * forme du payload n'était documentée nulle part, donc la conclusion tirée en
 * séance a été « il n'existe pas d'outil pour ajuster une quantité » — suivie
 * d'une écriture de journal, qui est le mauvais instrument.
 *
 * Leçon générale : une capacité générique que personne ne sait invoquer
 * équivaut à une capacité absente. Un outil nommé, avec le payload construit
 * pour l'appelant, vaut mieux qu'un pouvoir illimité invisible.
 */
const confirmationTolerante = z.preprocess((v) => {
    if (v === true)
        return true;
    if (typeof v === 'string' && v.trim().toLowerCase() === 'true')
        return true;
    return false;
}, z.boolean());
// TOLÉRANT sur la forme, STRICT sur le fond : une quantité peut arriver en
// chaîne (« 20 », « -3,5 ») selon le client MCP. Le zéro et le négatif sont
// des valeurs LÉGITIMES ici — un article à corriger est souvent négatif, et
// la cible est souvent zéro. D'où l'absence de .positive().
const quantiteTolerante = z.preprocess((v) => {
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v.trim().replace(',', '.'));
        if (!Number.isNaN(n))
            return n;
    }
    return v;
}, z.number());
export const qboInventaireAjuster = {
    name: 'ma_qbo_inventaire_ajuster',
    tier: 2,
    description: "Ajuste la QUANTITÉ EN MAIN d'un ou plusieurs articles d'inventaire dans QuickBooks (transaction " +
        '« Ajuster la quantité/valeur en main », entité InventoryAdjustment). C\'est le SEUL instrument ' +
        "correct pour fermer un écart entre le compte d'actif d'inventaire et le sous-registre par " +
        "article, ou pour ramener à zéro un article à quantité négative. ⚠️ N'utilise JAMAIS une écriture " +
        'de journal pour ça : elle ne touche que le solde du compte du grand livre, laisse les quantités ' +
        "inchangées, et déplace donc l'écart au lieu de le corriger — c'est exactement l'erreur qui a créé " +
        'un faux écart de 29 900 $. Cet outil corrige le sous-registre ET le grand livre ensemble. ' +
        '⚠️ APPROBATION HUMAINE OBLIGATOIRE, en deux temps. (1) Appelle SANS `confirmation` : tu obtiens, ' +
        "pour chaque article, la quantité actuelle, la quantité visée, l'écart, l'impact estimé sur la " +
        "valeur d'inventaire, le payload exact et un `jetonApprobation`. (2) PRÉSENTE cet aperçu à Gabriel " +
        "et ATTENDS son accord explicite — jamais dans le même tour de conversation. (3) Rappelle avec " +
        '`confirmation: true` ET `jetonApprobation`. Après écriture, chaque quantité est RELUE et comparée ' +
        "à la cible : c'est la seule preuve que le sous-registre a bougé. Commence toujours par " +
        'ma_qbo_inventaire_etat pour voir les noms exacts et les quantités. Nécessite QBO_WRITE_ENABLED.',
    inputSchema: z.object({
        sessionToken,
        date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("Date de la transaction d'ajustement (AAAA-MM-JJ). Pour corriger un solde de clôture, mets la " +
            'date de clôture — pas la date du jour, sinon la correction tombe dans le mauvais exercice.'),
        compteAjustement: z
            .string()
            .min(1)
            .describe("Compte de contrepartie : nom exact ou Id QuickBooks du compte où l'écart est imputé " +
            "(typiquement un compte d'écarts d'inventaire, ou le coût des marchandises vendues). Aucun " +
            "compte n'est créé automatiquement — ce choix a un effet direct sur le résultat, il doit être " +
            'délibéré.'),
        ajustements: z
            .array(z.object({
            article: z
                .string()
                .min(1)
                .describe("Nom exact ou Id QuickBooks de l'article d'inventaire."),
            nouvelleQuantite: quantiteTolerante
                .optional()
                .describe('Quantité VISÉE après ajustement. Préférable : QuickBooks calcule lui-même l\'écart au ' +
                "moment de l'écriture, donc le résultat reste juste même si l'article bouge entre " +
                "l'aperçu et la confirmation."),
            variationQuantite: quantiteTolerante
                .optional()
                .describe("Variation à appliquer (+ ou −), alternative à nouvelleQuantite. Fournir l'un OU l'autre, " +
                'jamais les deux — sinon la demande est ambiguë et elle est refusée.'),
        }))
            .min(1)
            .max(50)
            .describe("Articles à ajuster (50 maximum par transaction). Les articles dont la quantité visée égale " +
            "déjà la quantité en place sont écartés au lieu d'écrire une ligne sans effet."),
        champQuantite: z
            .enum(['NewQty', 'QtyDiff'])
            .default('QtyDiff')
            .describe("Nom du champ de quantite envoye a QuickBooks. Laisse le defaut : QtyDiff est la forme MESUREE " +
            "comme fonctionnelle (2026-08-20, ajustement reel verifie) ; QuickBooks REFUSE NewQty avec " +
            "« value must not be null : Line.ItemAdjustmentLineDetail.QtyDiff ». L'entite " +
            "InventoryAdjustment n'etant pas documentee publiquement par Intuit, ce parametre reste ouvert " +
            "au cas ou la forme acceptee changerait — le jour ou QtyDiff serait refuse, il faudra un appel " +
            "et non un deploiement. Aucune bascule automatique : un retry silencieux masquerait laquelle " +
            "des deux formes QuickBooks accepte."),
        memo: z.string().optional().describe("Mémo de l'ajustement. La mention « par l'application Marc André » est ajoutée automatiquement, jamais à sa place."),
        refNumber: z.string().optional().describe('Numéro de document (21 caractères maximum).'),
        confirmation: confirmationTolerante
            .default(false)
            .describe("FAUX (défaut) = aperçu : quantités actuelles, cibles, écarts, impact estimé et " +
            '`jetonApprobation`. VRAI exécute réellement — mais exige `jetonApprobation`.'),
        jetonApprobation: z
            .string()
            .optional()
            .describe("Jeton retourné par l'aperçu, obligatoire pour écrire. Lié au contenu EXACT et valable " +
            '15 minutes : si les quantités changent, il faut un nouvel aperçu, donc un nouvel accord.'),
    }),
    action: 'qbo_inventaire_ajuster',
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};
export const tier2InventaireAjusterTools = [qboInventaireAjuster];
