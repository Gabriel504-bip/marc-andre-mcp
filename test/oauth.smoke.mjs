// Test manuel autonome (démarre le serveur, exécute le flux OAuth complet,
// s'arrête) — même approche que test/smoke.manual.mjs, pour la même raison
// (les process détachés dans ce bac à sable ne répondent pas de façon fiable
// aux appels faits après coup).
import { createHash, randomBytes } from 'node:crypto';

process.env.MCP_BEARER_TOKEN ??= 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.MA_BASE_URL ??= 'https://example.invalid';
process.env.MA_AGENT_KEY ??= 'test-key';
process.env.MA_ALLOW_TIER2 ??= 'true';
process.env.MA_LOG_FILE ??= '/tmp/agent-actions-oauth.jsonl';

const { createApp } = await import('../dist/src/server.js');
const { app } = createApp();

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
console.log('listening on', port);

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

// 1. Métadonnées de découverte
const asMeta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
check('authorization_endpoint présent', asMeta.authorization_endpoint === `${base}/authorize`);
check('token_endpoint présent', asMeta.token_endpoint === `${base}/token`);

const rsMeta = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
check('resource metadata pointe vers /mcp', rsMeta.resource === `${base}/mcp`);

// 2. Enregistrement dynamique de client
const reg = await (
  await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/callback'] }),
  })
).json();
check('client_id renvoyé', typeof reg.client_id === 'string' && reg.client_id.length > 0);

// 3. PKCE
const codeVerifier = b64url(randomBytes(32));
const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
const redirectUri = 'https://claude.ai/api/mcp/callback';
const state = 'xyz123';

// 4. GET /authorize — doit renvoyer le formulaire HTML
const authorizeGetUrl =
  `${base}/authorize?response_type=code&client_id=${reg.client_id}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}` +
  `&code_challenge=${codeChallenge}&code_challenge_method=S256`;
const formRes = await fetch(authorizeGetUrl);
const formHtml = await formRes.text();
check('formulaire HTML renvoyé', formRes.status === 200 && formHtml.includes('name="secret"'));

// 5. POST /authorize avec MAUVAISE clé — doit être refusé
const badAuth = await fetch(`${base}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  redirect: 'manual',
  body: new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    secret: 'mauvaise-cle',
  }),
});
check('mauvaise clé refusée (401)', badAuth.status === 401);

// 6. POST /authorize avec la BONNE clé — doit rediriger avec un code
const goodAuth = await fetch(`${base}/authorize`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  redirect: 'manual',
  body: new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    secret: process.env.MCP_BEARER_TOKEN,
  }),
});
check('bonne clé -> redirection 302', goodAuth.status === 302);
const location = goodAuth.headers.get('location');
const code = location ? new URL(location).searchParams.get('code') : null;
check('code présent dans la redirection', typeof code === 'string' && code.length > 0);
check('state renvoyé intact', location ? new URL(location).searchParams.get('state') === state : false);

// 7. Échange du code contre un access_token, avec le bon code_verifier
const tokenRes = await fetch(`${base}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: reg.client_id,
  }),
});
const tokenJson = await tokenRes.json();
check('token endpoint -> 200', tokenRes.status === 200);
check(
  'access_token == MCP_BEARER_TOKEN',
  tokenJson.access_token === process.env.MCP_BEARER_TOKEN,
);

// 8. Mauvais code_verifier -> refus
const badPkce = await fetch(`${base}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: 'mauvais-verifier-mauvais-verifier-mauvais',
    client_id: reg.client_id,
  }),
});
check('mauvais code_verifier -> 400', badPkce.status === 400);

// 9. Rejeu du même code -> doit échouer la deuxième fois avec le mauvais
//    code_verifier ci-dessus déjà consommé un essai ; ici on vérifie que le
//    /mcp accepte bien le jeton obtenu à l'étape 7.
const mcpCall = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${tokenJson.access_token}`,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
check('appel /mcp avec le jeton obtenu -> authentifié (pas 401)', mcpCall.status !== 401);
if (mcpCall.status === 401) console.log('  détail:', mcpCall.status, await mcpCall.text());

// 9b. Flux réel d'un client MCP : initialize, PUIS tools/list, en deux
// requêtes HTTP séparées (comme le fait Claude) — c'est exactement le cas
// qui échouait avant le correctif sessionIdGenerator.
async function mcpRpc(method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokenJson.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} }),
  });
  const text = await r.text();
  // Réponse SSE ("event: message\ndata: {...}") ou JSON brut selon négociation.
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
  const jsonText = dataLine ? dataLine.slice(5).trim() : text;
  let parsed = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    /* laissé null, vérifié plus bas */
  }
  return { status: r.status, raw: text, parsed };
}

const initRes = await mcpRpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke-test', version: '0.0.1' },
});
check('initialize -> 200', initRes.status === 200);
check('initialize -> résultat JSON valide', !!initRes.parsed?.result);

const listRes = await mcpRpc('tools/list');
check('tools/list (requête séparée) -> 200', listRes.status === 200);
check(
  'tools/list -> liste non vide',
  Array.isArray(listRes.parsed?.result?.tools) && listRes.parsed.result.tools.length > 0,
);
if (!Array.isArray(listRes.parsed?.result?.tools) || listRes.parsed.result.tools.length === 0) {
  console.log('  détail tools/list:', listRes.status, listRes.raw.slice(0, 500));
}

// 10. Refresh token
const refreshRes = await fetch(`${base}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenJson.refresh_token }),
});
const refreshJson = await refreshRes.json();
check('refresh_token -> 200', refreshRes.status === 200);
check('refresh renvoie le même access_token', refreshJson.access_token === process.env.MCP_BEARER_TOKEN);

server.close();
console.log(failures === 0 ? '\nTOUT OK' : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
