import { randomUUID, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Config } from '../config.js';

/**
 * Serveur d'autorisation OAuth minimal, à secret unique partagé.
 *
 * Pourquoi ce fichier existe : l'interface d'ajout de connecteur personnalisé
 * de Claude (claude.ai) ne propose, hors bêta « en-têtes de requête » non
 * activée sur ce compte, que deux façons d'authentifier un connecteur MCP
 * distant : OAuth, ou rien. Ce serveur n'a qu'un seul identifiant partagé
 * (MCP_BEARER_TOKEN, voir D1 dans PALIERS.md) — pas de comptes utilisateurs.
 * On implémente donc juste assez d'OAuth 2.1 + PKCE pour que Claude puisse
 * réaliser l'échange standard, mais l'étape « autorisation » demande
 * simplement de retaper MCP_BEARER_TOKEN dans un formulaire web — c'est
 * l'équivalent exact de l'en-tête Authorization: Bearer, livré via le seul
 * mécanisme que l'interface supporte actuellement.
 *
 * Sans état côté serveur (obligatoire : fonctions Vercel éphémères, aucune
 * garantie qu'une requête retombe sur la même instance). Le "code"
 * d'autorisation est un jeton signé (HMAC avec MCP_BEARER_TOKEN comme clé),
 * pas une entrée en mémoire — vérifiable sans base de données.
 */

const CODE_TTL_MS = 5 * 60 * 1000;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function originOf(req: Request): string {
  const proto = req.header('x-forwarded-proto') ?? req.protocol ?? 'https';
  const host = req.header('x-forwarded-host') ?? req.header('host');
  return `${proto}://${host}`;
}

function signCode(secret: string, payload: Record<string, unknown>): string {
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyCode(
  secret: string,
  code: string,
): { redirectUri: string; codeChallenge: string } | null {
  const parts = code.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.exp !== 'number' || Date.now() > p.exp) return null;
  if (typeof p.redirectUri !== 'string' || typeof p.codeChallenge !== 'string') return null;
  return { redirectUri: p.redirectUri, codeChallenge: p.codeChallenge };
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

function renderForm(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  error?: string;
}): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Marc André — Autorisation</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:80px auto;padding:0 16px;color:#111}
input{width:100%;padding:10px;margin:8px 0;box-sizing:border-box;font-size:16px;border:1px solid #ccc;border-radius:6px}
button{width:100%;padding:10px;font-size:16px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-top:8px}
.err{color:#b00020;margin:8px 0;font-size:14px}
p.hint{color:#555;font-size:14px}
</style></head>
<body>
<h2>Autoriser Claude à accéder à Marc André</h2>
<p class="hint">Colle la clé d'accès (MCP_BEARER_TOKEN) pour confirmer cette connexion.</p>
${p.error ? `<p class="err">${escapeHtml(p.error)}</p>` : ''}
<form method="POST" action="/authorize">
  <input type="hidden" name="client_id" value="${escapeHtml(p.clientId)}" />
  <input type="hidden" name="redirect_uri" value="${escapeHtml(p.redirectUri)}" />
  <input type="hidden" name="state" value="${escapeHtml(p.state)}" />
  <input type="hidden" name="code_challenge" value="${escapeHtml(p.codeChallenge)}" />
  <input type="hidden" name="code_challenge_method" value="${escapeHtml(p.codeChallengeMethod)}" />
  <input type="password" name="secret" placeholder="Clé d'accès (MCP_BEARER_TOKEN)" autofocus required />
  <button type="submit">Autoriser</button>
</form>
</body></html>`;
}

export function registerOAuthRoutes(app: Express, config: Config): void {
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const base = originOf(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    const base = originOf(req);
    res.json({ resource: `${base}/mcp`, authorization_servers: [base] });
  });

  app.post('/register', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json({
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris ?? [],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  app.get('/authorize', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (q.response_type !== 'code' || !q.redirect_uri || !q.code_challenge) {
      res.status(400).send('Requête OAuth invalide (paramètres manquants).');
      return;
    }
    res
      .set('content-type', 'text/html; charset=utf-8')
      .send(
        renderForm({
          clientId: q.client_id ?? '',
          redirectUri: q.redirect_uri,
          state: q.state ?? '',
          codeChallenge: q.code_challenge,
          codeChallengeMethod: q.code_challenge_method ?? 'S256',
        }),
      );
  });

  app.post('/authorize', (req, res) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const expected = Buffer.from(config.mcpBearerToken, 'utf8');
    const provided = Buffer.from(b.secret ?? '', 'utf8');
    const ok = provided.length === expected.length && timingSafeEqual(provided, expected);

    if (!b.redirect_uri || !b.code_challenge) {
      res.status(400).send('Requête OAuth invalide (paramètres manquants).');
      return;
    }

    if (!ok) {
      res
        .status(401)
        .set('content-type', 'text/html; charset=utf-8')
        .send(
          renderForm({
            clientId: b.client_id ?? '',
            redirectUri: b.redirect_uri,
            state: b.state ?? '',
            codeChallenge: b.code_challenge,
            codeChallengeMethod: b.code_challenge_method ?? 'S256',
            error: 'Clé invalide. Réessaie.',
          }),
        );
      return;
    }

    const code = signCode(config.mcpBearerToken, {
      redirectUri: b.redirect_uri,
      codeChallenge: b.code_challenge,
      exp: Date.now() + CODE_TTL_MS,
    });

    const redirect = new URL(b.redirect_uri);
    redirect.searchParams.set('code', code);
    if (b.state) redirect.searchParams.set('state', b.state);
    res.redirect(302, redirect.toString());
  });

  app.post('/token', (req, res) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;

    if (b.grant_type === 'refresh_token') {
      // Jeton unique, statique, sans rotation — un seul identifiant partagé
      // pour cet outil interne (voir décision D1, PALIERS.md).
      res.json({ access_token: config.mcpBearerToken, token_type: 'Bearer', expires_in: 3600 });
      return;
    }

    if (b.grant_type !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }

    const verified = b.code ? verifyCode(config.mcpBearerToken, b.code) : null;
    if (!verified) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    if (!b.redirect_uri || verified.redirectUri !== b.redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }
    if (!b.code_verifier || !verifyPkce(b.code_verifier, verified.codeChallenge)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE invalide' });
      return;
    }

    res.json({
      access_token: config.mcpBearerToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: config.mcpBearerToken,
    });
  });
}
