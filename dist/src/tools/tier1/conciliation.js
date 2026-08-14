import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { truncateList } from '../../format/summarize.js';
/**
 * Conciliation d'exercice (relevé bancaire déposé vs registre QuickBooks).
 * Les trois outils de ce fichier sont en LECTURE SEULE côté marc-andre-app —
 * aucun d'eux ne modifie ni le relevé, ni QuickBooks, ni le module Écritures.
 * Seul ma_conciliation_exercice_vers_ecritures (palier 2, tier2/conciliation.ts)
 * a un effet.
 */
/**
 * Paramètres communs aux quatre outils de conciliation d'exercice.
 * `exercice` OU `anneeDebut` doit être fourni (jamais les deux exigés à la
 * fois — un seul suffit à identifier l'exercice du 1er juillet au 30 juin).
 */
/**
 * 🆕 (2026-08-13) — TOLÉRANCE DE FORMAT côté serveur, sur les deux champs
 * ajoutés ce jour-là. Les clients MCP ne sérialisent pas les types composés
 * de la même façon : certains envoient un vrai tableau JSON, d'autres la
 * même valeur encodée en CHAÎNE ("[{...}]"), et pareil pour les booléens
 * ("false" au lieu de false). Un schéma strict refusait alors une décision
 * parfaitement valide avec « Expected array, received string » — l'appelant
 * n'avait aucun moyen de s'en sortir, le champ étant correct sur le fond.
 *
 * Même principe que `normaliserTransactionsExtraites` côté marc-andre-app,
 * qui accepte trois formes d'extraction : on est TOLÉRANT sur la FORME,
 * STRICT sur le FOND. Une chaîne est décodée puis validée exactement comme
 * si elle était arrivée nativement — une valeur réellement invalide est
 * toujours refusée, jamais devinée ni appliquée à moitié.
 */
const booleenTolerant = z.preprocess((v) => {
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true')
            return true;
        if (s === 'false')
            return false;
    }
    return v;
}, z.boolean());
const decisionAmbigu = z.object({
    codeReleve: z.string().min(1).describe('Code de la ligne de relevé ambiguë (ex. "R-2223-2304").'),
    codeQboRetenu: z
        .string()
        .min(1)
        .describe('Code du candidat QuickBooks RETENU comme correspondance (ex. "Q-2223-2304"). ' +
        'Doit être l\'un des candidats réels de cette ambiguïté, sinon la décision est refusée.'),
});
const decisionsAmbigusTolerant = z.preprocess((v) => {
    if (typeof v === 'string') {
        const s = v.trim();
        if (s === '')
            return undefined;
        try {
            return JSON.parse(s);
        }
        catch {
            return v; // laisse zod refuser proprement, avec un message parlant
        }
    }
    return v;
}, z.array(decisionAmbigu));
export const exerciceInputSchema = z
    .object({
    sessionToken,
    exercice: z
        .string()
        .regex(/^\d{4}-\d{4}$/, 'Format attendu : "AAAA-AAAA" (ex. "2022-2023")')
        .optional()
        .describe('Exercice au format "AAAA-AAAA" (ex. "2022-2023"), du 1er juillet au 30 juin.'),
    anneeDebut: z
        .number()
        .int()
        .optional()
        .describe('Année de début de l\'exercice (ex. 2022 pour l\'exercice 2022-2023) — alternative à exercice.'),
    compte: z
        .string()
        .default('Chequing(-952)')
        .optional()
        .describe('Compte bancaire à concilier.'),
    rechargerQbo: z
        .boolean()
        .default(false)
        .optional()
        .describe("Force un rechargement des données QuickBooks avant la comparaison plutôt que d'utiliser le cache."),
    inclureMoisNonFermes: z
        .boolean()
        .default(false)
        .optional()
        .describe('Inclut les mois dont la fermeture comptable n\'est pas encore confirmée (par défaut ' +
        'écartés — voir les mois écartés renvoyés avec leur cause).'),
    /**
     * 🆕 (2026-08-13) — sans ce champ dans le schéma, zod le SUPPRIMAIT en
     * silence (`.object()` élague les clés inconnues) : les décisions
     * arrivaient donc jamais au moteur, qui répondait
     * `decisionsAppliquees: []` / `nbAmbigusNonResolues: 2` sans le moindre
     * message d'erreur — un échec muet, le pire genre. Constaté en
     * production sur l'exercice 2022-2023 (Clinique Entre-nous) : deux
     * ambiguïtés départagées par Gabriel restaient éternellement en attente.
     *
     * Effet côté marc-andre-app : `appliquerDecisionsAmbigus`
     * (lib/conciliation-exercice.js) apparie la ligne de relevé au candidat
     * QuickBooks retenu, et les candidats PERDANTS deviennent des lignes à
     * supprimer (sauf une paie, qui ne rejoint JAMAIS aSupprimer — invariant
     * du moteur). Une décision qui nomme un candidat inexistant est REFUSÉE
     * (jamais appliquée au hasard) et renvoyée dans `decisionsRefusees`.
     *
     * Reste sans danger en palier 1 : sur les étapes csv/excel, ces décisions
     * ne changent que le CONTENU D'UN FICHIER que Gabriel relit avant de
     * l'appliquer — aucune suppression n'est déclenchée dans QuickBooks par
     * cet outil.
     */
    decisionsAmbigus: decisionsAmbigusTolerant
        .optional()
        .describe('Décisions humaines départageant les ambiguïtés (une ligne de relevé, plusieurs candidats ' +
        'QuickBooks de types différents). Chaque entrée apparie une ligne de relevé au candidat ' +
        'retenu ; les candidats perdants deviennent des lignes à supprimer. Les ambiguïtés sans ' +
        'décision restent en attente — jamais tranchées au hasard.'),
    /**
     * 🆕 (2026-08-13) — également élagué en silence avant ce correctif. Chaque
     * étape de marc-andre-app a sa PROPRE valeur par défaut (lecture : false,
     * pour rester sous le délai ; csv : true, pour ne jamais produire un CSV
     * de suppression à partir d'un relevé incomplet). On n'impose donc AUCUN
     * défaut ici : omettre le champ conserve exactement le comportement
     * actuel de chaque étape.
     */
    reparerReleves: booleenTolerant
        .optional()
        .describe('Relit (via IA) les relevés dont la balance ne ferme pas avant de comparer. Omis = défaut ' +
        "propre à chaque étape (lecture : non ; CSV de suppression : oui). Coûte du temps et un " +
        'appel IA par mois réparé ; persiste la meilleure extraction, jamais une pire.'),
})
    .refine((v) => !!v.exercice || v.anneeDebut !== undefined, {
    message: 'Précise exercice (ex. "2022-2023") ou anneeDebut (ex. 2022).',
});
const MAX_ECHANTILLON = 8;
/**
 * 🆕 (2026-08-13) — les étapes `csv` / `excel` / `vers_ecritures` de
 * marc-andre-app relisent jusqu'à 2 relevés par appel (un appel IA chacun)
 * AVANT de produire leur sortie — elles dépassent donc volontairement les
 * 15 000 ms du défaut global, et le faisaient échouer systématiquement côté
 * MCP alors que le travail aboutissait et se persistait mois par mois.
 * 60 s couvre le cas réel observé (2 relevés BMO de ~10 pages) tout en
 * restant sous la limite d'exécution d'une fonction Vercel.
 *
 * 🔄 RÉVISÉ (2026-08-14) — `ma_conciliation_exercice` passe elle aussi à 60 s.
 *
 * La règle précédente disait : « lecture pure, elle est censée répondre vite,
 * et si elle traîne c'est un signal, pas à masquer ». Le raisonnement était
 * juste, mais il supposait un CACHE QBO CHAUD. À froid — après un
 * `forcerRelecture`, ou simplement après expiration — l'outil relit tout le
 * grand livre de l'exercice (3 000+ lignes sur le dossier réel) PLUS les
 * relevés mensuels : 15 à 60 s, légitimement.
 *
 * Ce qui s'est passé le 2026-08-14 : chaque appel aboutissait côté serveur
 * (HTTP 200 dans les journaux Vercel) mais le MCP raccrochait à 15 s.
 * L'appelant, ne voyant jamais de réponse, réessayait — et chaque tentative
 * relançait une lecture complète. Résultat : throttling Microsoft 365 (429),
 * puis écran de connexion cassé pour Gabriel. Le garde-fou censé « ne pas
 * masquer un signal » a produit une boucle de charge bien pire que le
 * ralentissement qu'il signalait.
 *
 * 🔄 RÉVISÉ À NOUVEAU (2026-08-14, soirée) — 60 s → 300 s.
 *
 * Les 60 s ne suffisaient toujours pas : sur cache QBO froid ET pendant un
 * ralentissement SharePoint (chaque lecture de fichier partant en retry avec
 * backoff), la lecture complète dépassait aussi les 60 s. La fonction Vercel
 * était alors tuée AVANT d'avoir écrit le cache — donc l'appel suivant
 * repartait à froid, et ainsi de suite. Une boucle sans issue : le seul moyen
 * de réchauffer le cache était de réussir un appel, et aucun appel ne pouvait
 * réussir.
 *
 * Gabriel est passé au plan Vercel Pro le 2026-08-14. La route côté app porte
 * DÉJÀ `maxDuration = 300` (elle était écrite pour, mais le plan Hobby la
 * plafonnait silencieusement à 60 s). 300 s est le maximum d'une fonction
 * standard sur Pro : les deux couches sont donc alignées au même plafond.
 *
 * Le signal existe toujours — il est simplement placé là où un dépassement
 * signifie vraiment une panne, et non « le dossier est gros et le cache est
 * froid ».
 *
 * ⚠️ Le vrai correctif reste à faire : cette route devrait rendre un `jobId`
 * immédiatement et travailler en arrière-plan (comme `qbo_analyse_*`). 300 s
 * repousse le plafond, il ne le supprime pas.
 */
export const TIMEOUT_CONCILIATION_LENTE_MS = 300_000;
/**
 * Élagage générique : toute liste volumineuse (catégories de lignes,
 * mois détaillés, etc.) est réduite à un échantillon annoncé — jamais un
 * dump complet de centaines de lignes. Les compteurs, la parité et les
 * mois écartés (structures petites) passent tels quels.
 */
export function summarizeConciliation(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return raw;
    const out = {};
    const troncatures = [];
    for (const [key, value] of Object.entries(raw)) {
        if (Array.isArray(value) && value.length > MAX_ECHANTILLON) {
            const { items, truncated, totalAvant } = truncateList(value, MAX_ECHANTILLON);
            out[key] = { total: totalAvant, echantillon: items, troncature: truncated };
            troncatures.push(key);
        }
        else {
            out[key] = value;
        }
    }
    if (troncatures.length > 0) {
        out.avertissementTroncature =
            `Catégories réduites à un échantillon de ${MAX_ECHANTILLON} lignes (${troncatures.join(', ')}) ` +
                '— ce n\'est pas le dump complet. Utilise ma_conciliation_exercice_excel (plan de correction) ' +
                'ou ma_conciliation_exercice_csv (suppressions) pour le détail exhaustif.';
    }
    return out;
}
/**
 * Annonce la taille des champs de type fichier encodé en base64 sans les
 * résumer ni les tronquer — Claude doit recevoir le base64 intact pour le
 * transmettre tel quel, seule la taille affichée est calculée ici.
 */
function annoncerTailleBase64(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return raw;
    const tailles = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string' && value.length > 500) {
            const octetsApprox = Math.round((value.length * 3) / 4);
            tailles[key] = `~${(octetsApprox / 1024).toFixed(1)} Ko (base64, non tronqué)`;
        }
    }
    return Object.keys(tailles).length > 0 ? { ...raw, tailleFichiers: tailles } : raw;
}
export const conciliationExercice = {
    name: 'ma_conciliation_exercice',
    tier: 1,
    description: 'Compare le relevé bancaire déposé et le registre QuickBooks pour un exercice complet (1er ' +
        'juillet → 30 juin), avec priorité stricte à la paie et sans jamais deviner en cas ' +
        "d'ambiguïté. Lecture seule. Renvoie les catégories (à supprimer, à ajouter, paie sans " +
        'retrait, ambigus, en attente de décision), la parité en nombre de lignes et en montant, et ' +
        'les mois écartés avec leur cause. ⚠️ Les catégories volumineuses sont réduites à un ' +
        'échantillon — jamais le dump complet (voir avertissementTroncature).',
    inputSchema: exerciceInputSchema,
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
    action: 'conciliation_exercice',
    postProcess: (raw) => summarizeConciliation(raw),
};
export const conciliationExerciceExcel = {
    name: 'ma_conciliation_exercice_excel',
    tier: 1,
    description: 'Plan de correction en .xlsx (base64) : résumé mois par mois, à supprimer, à ajouter, à ' +
        'corriger, en attente de décision, contrôle. Lecture seule. Le base64 est renvoyé intact ' +
        '(non résumé) — seule sa taille approximative est annoncée.',
    inputSchema: exerciceInputSchema,
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
    action: 'conciliation_exercice_excel',
    postProcess: (raw) => annoncerTailleBase64(raw),
};
export const conciliationExerciceCsv = {
    name: 'ma_conciliation_exercice_csv',
    tier: 1,
    description: 'CSV des suppressions, prêt pour le panneau « Correctifs en lot par CSV ». Lecture seule, ne ' +
        'supprime rien. Le contenu est renvoyé intact (non résumé) — seule sa taille approximative ' +
        'est annoncée si encodé en base64.',
    inputSchema: exerciceInputSchema,
    timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
    action: 'conciliation_exercice_csv',
    postProcess: (raw) => annoncerTailleBase64(raw),
};
export const tier1ConciliationTools = [
    conciliationExercice,
    conciliationExerciceExcel,
    conciliationExerciceCsv,
];
