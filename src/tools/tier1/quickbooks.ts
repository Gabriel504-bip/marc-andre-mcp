import { z } from 'zod';
import { sessionToken } from '../../schemas/common.js';
import type { ToolDefinition } from '../types.js';

/** §3.1 outils 6-7. */

export const qboStatut: ToolDefinition = {
  name: 'ma_qbo_statut',
  tier: 1,
  description:
    'Statut de connexion QuickBooks (connecté, compagnie, environnement). Ne renvoie jamais de ' +
    "jeton QBO — la route sous-jacente a une vue publique dédiée qui les filtre déjà. Précise " +
    "soit sessionToken (un client), soit cabinet=true (vue cabinet).",
  inputSchema: z
    .object({
      sessionToken: sessionToken.optional(),
      cabinet: z.boolean().optional(),
    })
    .refine((v) => !!v.sessionToken || !!v.cabinet, {
      message: 'Précise sessionToken ou cabinet=true.',
    }),
  action: 'qbo_statut',
};

export const qboListesReference: ToolDefinition = {
  name: 'ma_qbo_listes_reference',
  tier: 1,
  description:
    "Listes de référence QuickBooks d'un client (comptes, clients/fournisseurs, codes de taxe, " +
    "classes, emplacements). Si la réponse indique une connexion QuickBooks expirée, dis-le à " +
    "Gabriel et propose-lui d'aller reconnecter depuis la fiche client dans marc-andre-app — " +
    "NE TENTE JAMAIS de reconnecter toi-même (geste réservé au palier 3).",
  inputSchema: z.object({
    sessionToken,
    refresh: z.boolean().default(false).optional(),
  }),
  action: 'qbo_listes_reference',
};

export const tier1QuickbooksTools = [qboStatut, qboListesReference];
