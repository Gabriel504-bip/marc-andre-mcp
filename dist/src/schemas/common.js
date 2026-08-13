import { z } from 'zod';
/** sessionToken = clé primaire de tout le système côté marc-andre-app (§1.5). */
export const sessionToken = z.string().min(8).describe("Jeton de session du client (retourné par ma_chercher_client ou ma_lister_clients). " +
    'Ce n\'est pas un identifiant lisible — toujours obtenu via un autre outil, jamais inventé.');
export const dateStr = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : YYYY-MM-DD')
    .describe('Date au format YYYY-MM-DD');
export const pagination = {
    page: z.number().int().min(1).default(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25).optional(),
};
