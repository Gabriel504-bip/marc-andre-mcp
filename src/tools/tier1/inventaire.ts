import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import { TIMEOUT_CONCILIATION_LENTE_MS } from './conciliation.js';
import type { ToolDefinition } from '../types.js';

/**
 * État de l'inventaire, article par article — 2026-08-20.
 *
 * Ce qui a rendu cet outil nécessaire : un écart entre le compte d'actif
 * d'inventaire et le sous-registre par article a été « corrigé » par une
 * écriture de journal. Le solde du compte a bougé, donc tout paraissait
 * réglé — mais les quantités négatives étaient toujours là, et l'écart de
 * 29 900 $ s'était simplement inversé de sens.
 *
 * Aucun outil ne montrait les quantités par article. Sans cette vue, l'écart
 * est invisible et on ne peut que le deviner. C'est le même schéma que
 * TaxApplicableOn : la donnée existait dans QuickBooks, rien ne l'affichait,
 * donc l'erreur restait indétectable pendant qu'on croyait corriger.
 */
export const qboInventaireEtat: ToolDefinition = {
  name: 'ma_qbo_inventaire_etat',
  tier: 1,
  description:
    "État de l'INVENTAIRE dans QuickBooks, article par article : quantité en main, coût unitaire, " +
    "valeur du sous-registre, compte d'actif rattaché. Signale explicitement les articles à QUANTITÉ " +
    "NÉGATIVE (signe d'une vente enregistrée sans l'achat correspondant) et compare, pour chaque " +
    "compte d'actif, la valeur du sous-registre au solde du grand livre — c'est cette comparaison qui " +
    'révèle un écart GL vs sous-registre. À utiliser AVANT tout ajustement, et à nouveau après, pour ' +
    'vérifier. ⚠️ Un écart de ce type ne se corrige JAMAIS par une écriture de journal : une écriture ' +
    'de journal ne touche que le solde du compte du grand livre et laisse les quantités intactes, donc ' +
    "elle déplace l'écart au lieu de le fermer. Utilise ma_qbo_inventaire_ajuster. Le solde du grand " +
    "livre retourné ici est celui d'AUJOURD'HUI (QuickBooks n'expose pas de solde à une date passée " +
    "sur un compte) : ne t'en sers pas pour valider une date de clôture. Lecture seule.",
  inputSchema: z.object({
    sessionToken,
    inclureInactifs: z
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Inclure les articles désactivés. FAUX par défaut — mais un article désactivé peut porter une ' +
          "quantité résiduelle qui explique un écart, donc à essayer si l'écart reste inexpliqué."
      ),
  }),
  action: 'qbo_inventaire_etat',
  timeoutMs: TIMEOUT_CONCILIATION_LENTE_MS,
};

export const tier1InventaireTools = [qboInventaireEtat];
