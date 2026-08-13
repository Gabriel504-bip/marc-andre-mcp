import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config.js';

/**
 * Authentifie les appels ENTRANTS vers ce serveur MCP hébergé (distinct de
 * MA_AGENT_KEY, qui authentifie ce serveur AUPRÈS de marc-andre-app).
 *
 * Piège documenté à ne pas reproduire (vu dans app/api/cron/* de
 * marc-andre-app) : `if (secret && header !== attendu)` — si la variable
 * est absente, la route est OUVERTE. Ici la logique est inversée :
 * jeton absent ou mal formé ⇒ refus systématique, sans exception.
 *
 * Comparaison en temps constant pour éviter une fuite d'information par
 * mesure de timing sur la comparaison de chaînes.
 */
export function requireBearerAuth(config: Config) {
  const expected = Buffer.from(config.mcpBearerToken, 'utf8');

  return function (req: Request, res: Response, next: NextFunction) {
    // Pointe les clients OAuth (dont Claude) vers les métadonnées de
    // découverte (RFC 9728) — voir src/oauth/authServer.ts.
    const proto = req.header('x-forwarded-proto') ?? req.protocol ?? 'https';
    const host = req.header('x-forwarded-host') ?? req.header('host');
    const resourceMetadataUrl = `${proto}://${host}/.well-known/oauth-protected-resource`;
    res.set('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);

    const header = req.header('authorization') ?? '';
    const match = /^Bearer (.+)$/.exec(header);

    if (!match) {
      res.status(401).json({ error: 'Authorization: Bearer <token> requis.' });
      return;
    }

    const provided = Buffer.from(match[1], 'utf8');

    // timingSafeEqual exige des buffers de même longueur — un mismatch de
    // longueur est déjà un refus, pas une exception à laisser fuiter.
    const ok =
      provided.length === expected.length && timingSafeEqual(provided, expected);

    if (!ok) {
      res.status(401).json({ error: 'Jeton invalide.' });
      return;
    }

    next();
  };
}

export function requireAgentEnabled(config: Config) {
  return function (_req: Request, res: Response, next: NextFunction) {
    if (!config.agentEnabled) {
      res.status(503).json({
        error:
          "Agent désactivé (AGENT_ENABLED=false). Geste d'urgence actif — voir README pour le réactiver.",
      });
      return;
    }
    next();
  };
}
