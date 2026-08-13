# Contrat attendu côté marc-andre-app — ⏸ EN ATTENTE DU GO

**Rien de ce document n'a été implémenté dans marc-andre-app.** C'est la
spécification que la passerelle `marc-andre-mcp` appelle déjà (voir
`src/core/httpClient.ts`) — tant que ces routes n'existent pas, chaque outil
échoue avec une erreur claire (404), jamais un plantage silencieux. À
implémenter dans une session dédiée au code de marc-andre-app, seulement
quand Gabriel donne le GO, et seulement des **ajouts** (aucune route
existante n'est modifiée).

## 1. Nouveau module `lib/agent-authz.js`

```js
// lib/agent-authz.js
import { timingSafeEqual } from 'node:crypto';
import { logAction } from './audit.js';

export async function requireAgent(request) {
  if (process.env.AGENT_ENABLED !== 'true') {
    return { ok: false, status: 503, error: 'Agent désactivé (AGENT_ENABLED).' };
  }
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return { ok: false, status: 401, error: 'Authorization: Bearer requis.' };

  const expected = Buffer.from(process.env.AGENT_API_KEY || '', 'utf8');
  const provided = Buffer.from(match[1], 'utf8');
  const ok = expected.length > 0 && provided.length === expected.length &&
    timingSafeEqual(provided, expected);
  if (!ok) return { ok: false, status: 401, error: 'Clé agent invalide.' };

  const agentId = request.headers.get('x-agent-id') || 'unknown';
  const requestId = request.headers.get('x-agent-request-id') || null;
  return { ok: true, actor: { kind: 'agent', agentId, requestId, label: 'Claude (MCP)' } };
}

// Enveloppe logAction() en imposant actor + await (jamais fire-and-forget
// pour un geste automatisé — contrairement au comportement par défaut
// côté humain).
export async function logAgentAction({ agentId, requestId, action, targetClient, details }) {
  await logAction({
    userId: `agent:${agentId}`,
    email: null,
    action: `agent_${action}`,
    targetClient,
    details,
    actor: 'agent',
    agentId,
    requestId,
  });
}
```

⚠️ Ne JAMAIS accepter `AGENT_API_KEY` là où `ADMIN_API_KEY`/`staffToken` sont
attendus, et réciproquement — deux univers étanches (voir rapport
d'architecture §2.1, option C retenue).

## 2. Extension de `logAction()` dans `lib/audit.js`

Ajouter 3 champs optionnels, rétrocompatibles (rien ne casse si absents) :
`actor` ('human' | 'agent' | 'cron', défaut 'human'), `agentId`, `requestId`.

## 3. Trois nouvelles routes sous `app/api/agent/`

### `GET /api/agent/health`
```js
export async function GET(request) {
  const auth = await requireAgent(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    ok: true,
    tier1: true,
    tier2Enabled: process.env.AGENT_ALLOW_TIER2 === 'true',
    qboWriteEnabled: isQboWriteEnabled(), // lib/quickbooks.js, déjà existant
    safeModeEmail: process.env.SAFE_MODE_EMAIL || null,
  });
}
```

### `GET /api/agent/tools`
Retourne la même table que `ALLOWLIST` ci-dessous (nom, palier, description)
— source de vérité lisible sans redéployer marc-andre-mcp.

### `POST /api/agent/invoke`
```js
const ALLOWLIST = {
  // palier 1 — lecture seule
  chercher_client:        { tier: 1, handler: chercherClient },
  lister_clients:         { tier: 1, handler: listerClients },
  fiche_client:           { tier: 1, handler: ficheClient },
  ecritures:              { tier: 1, handler: ecrituresList },
  statut_job:             { tier: 1, handler: statutJob },
  qbo_statut:             { tier: 1, handler: qboStatut },
  qbo_listes_reference:   { tier: 1, handler: qboReferenceLists },
  finance:                { tier: 1, handler: financeSnapshot },
  taches_equipe:          { tier: 1, handler: tachesEquipe },
  journal_audit:          { tier: 1, handler: journalAudit },
  accueil_synthese:       { tier: 1, handler: accueilSynthese },
  // palier 2 — n'enregistrer que si AGENT_ALLOW_TIER2 === 'true'
  qbo_analyse_preparer:   { tier: 2, handler: qboAnalysePreparer },
  qbo_job_start:          { tier: 2, handler: qboJobStart },
  qbo_job_step:           { tier: 2, handler: qboJobStep },
  facturation_apercu:     { tier: 2, handler: facturationApercu },
  facturation_job_start:  { tier: 2, handler: facturationJobStart },
  facturation_job_step:   { tier: 2, handler: facturationJobStep },
  relance_preparer:       { tier: 2, handler: relancePreparer },
  relance_executer:       { tier: 2, handler: relanceExecuter },
};

export async function POST(request) {
  const auth = await requireAgent(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { tool, input, requestId } = await request.json();
  const entry = ALLOWLIST[tool];
  if (!entry || (entry.tier === 2 && process.env.AGENT_ALLOW_TIER2 !== 'true')) {
    return NextResponse.json({ error: `Outil « ${tool} » inconnu ou non autorisé.` }, { status: 404 });
  }

  try {
    const result = await entry.handler(input, { ...auth.actor, requestId });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
```

**Principe clé (§2.4 du rapport) : les handlers appellent les fonctions
`lib/*` DIRECTEMENT** (`loadSession`, `listAllSessions`, `loadAuditLog`,
`fetchFinanceSnapshot`, etc. — celles déjà utilisées par les routes
`app/api/admin/*` existantes), jamais via une requête HTTP interne vers
`/api/admin/*`. Pas de double authentification, pas de secret cabinet à
transporter, et **aucune modification des routes existantes**.

## 4. Mapping action → fonctions `lib/*` déjà existantes

| Action | Fonctions à réutiliser (déjà en production) |
|---|---|
| `chercher_client` | `listAllSessions()` + filtre local (même normalisation que `ecritures-list::normalizeSearchText`) |
| `lister_clients` | logique de `app/api/admin/sessions/route.js` |
| `fiche_client` | logique de `app/api/admin/client-detail/route.js` |
| `ecritures` | logique de `app/api/admin/ecritures-list/route.js` |
| `statut_job` | `loadQboJobDetail()` (`lib/sharepoint.js`) |
| `qbo_statut` | `publicView()` de `lib/quickbooks.js` |
| `qbo_listes_reference` | logique de `app/api/quickbooks/reference-lists/route.js` |
| `finance` | `fetchFinanceSnapshot()` (`lib/finance.js`), cache 5 min existant |
| `taches_equipe` | logique de `app/api/admin/toutes-taches/route.js` |
| `journal_audit` | `loadAuditLog()` (`lib/sharepoint.js`) — contourne le bug 401 actuel de la route humaine |
| `accueil_synthese` | logique de `app/api/admin/accueil-synthese/route.js` |
| `qbo_job_start` / `qbo_job_step` | logique de `app/api/qbo-jobs/{start,step}/route.js`, **sans modification** |
| `facturation_apercu` | logique de `app/api/admin/facturation-import/route.js` |
| `facturation_job_start` / `_step` | logique de `app/api/admin/facturation-jobs/{start,step}/route.js` |
| `relance_preparer` / `relance_executer` | logique de `app/api/admin/relance/route.js`, via `validateAccess()` brut (pas `requireStaff`) |

## 5. Nouvelles variables d'environnement (Vercel)

```
AGENT_API_KEY=<secret aléatoire ≥ 48 caractères, distinct de ADMIN_API_KEY>
AGENT_ENABLED=true
AGENT_ALLOW_TIER2=false
```

## 6. Bug incident trouvé en passant (hors de ce contrat)

`app/api/admin/audit-log/route.js` ligne ~17 : `requireAdmin(request)` au
lieu de `requireAdmin({adminKey, staffToken})` → 401 systématique. Correctif
d'une ligne, indépendant de ce chantier.

## 7. Ordre d'implémentation suggéré

1. `lib/agent-authz.js` + extension `logAction()`.
2. `/api/agent/health` + `/api/agent/tools` (lecture pure, aucun risque).
3. `/api/agent/invoke` avec l'allowlist **palier 1 seulement**.
4. Déployer, observer quelques jours (voir critères d'acceptation ci-dessous).
5. Ouvrir le palier 2 dans l'allowlist, dans l'ordre de risque croissant :
   analyse QBO → aperçu facturation → rapprochement → relance (avec
   `SAFE_MODE_EMAIL` actif pour le premier essai réel).

## Critères d'acceptation

1. Avec `AGENT_API_KEY`, un appel à `admin/update-user` ou `auth/invite` échoue — et c'est vérifiable.
2. Chaque geste de l'agent apparaît dans `/app/audit` avec `actor: 'agent'`.
3. `AGENT_ENABLED=false` coupe tout immédiatement, sans redéploiement.
4. Aucun humain déconnecté pendant que l'agent travaillait (canari 429 Graph).
5. Le premier courriel de relance déclenché par l'agent part à `SAFE_MODE_EMAIL`, pas à un vrai client.
