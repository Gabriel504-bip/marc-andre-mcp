// Test manuel, exécuté en une seule fois (démarre le serveur, tape sur
// ses propres routes, s'arrête) — sert à vérifier le câblage HTTP sans
// dépendre d'un process d'arrière-plan détaché.
process.env.MCP_BEARER_TOKEN ??= 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.MA_BASE_URL ??= 'https://example.invalid';
process.env.MA_AGENT_KEY ??= 'test-key';
process.env.MA_ALLOW_TIER2 ??= 'true';
process.env.MA_LOG_FILE ??= '/tmp/agent-actions.jsonl';

const { createApp } = await import('../src/server.ts');
const { app, config } = createApp();

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
console.log('listening on', port);

const base = `http://127.0.0.1:${port}`;

const h = await fetch(`${base}/healthz`);
console.log('healthz', h.status, await h.json());

const noAuth = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
console.log('sans auth ->', noAuth.status, await noAuth.text());

const wrongAuth = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
console.log('mauvais jeton ->', wrongAuth.status, await wrongAuth.text());

const goodAuth = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${process.env.MCP_BEARER_TOKEN}`,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
console.log('bon jeton -> status', goodAuth.status);
const text = await goodAuth.text();
console.log(text.slice(0, 2000));

server.close();
process.exit(0);
