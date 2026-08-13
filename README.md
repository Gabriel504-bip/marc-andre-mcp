# marc-andre-mcp

Passerelle MCP — expose certaines fonctions de **marc-andre-app** à Claude, en
paliers de risque. Projet **séparé**, ne modifie aucun fichier de
marc-andre-app. Voir `PALIERS.md` pour la gouvernance (quel outil fait quoi).

## Ce qui n'existe pas encore

Ce serveur appelle `POST {MA_BASE_URL}/api/agent/invoke` et
`GET {MA_BASE_URL}/api/agent/health`. **Ces routes n'existent pas encore
côté marc-andre-app** — elles ne seront implémentées qu'après le GO explicite
de Gabriel. Tant qu'elles n'existent pas, chaque appel d'outil échoue avec un
message clair (404 « route introuvable »), jamais un plantage silencieux.
Le contrat exact attendu est documenté séparément (voir le mandat « contrat
d'API côté Marc André », en attente).

## Démarrage

```bash
npm install
cp .env.example .env   # puis remplir MCP_BEARER_TOKEN, MA_BASE_URL, MA_AGENT_KEY
npm run dev             # serveur sur :8787, endpoint MCP sur /mcp
npm run list-tools      # imprime le catalogue sans appel réseau
npm test
```

## ⚠️ Où héberger ce serveur (décision D9 : hébergé, pas local)

Le palier 2 pilote une boucle de job qui peut tourner plusieurs minutes
(`src/jobs/stepDriver.ts`, jusqu'à 20 min de budget, une étape toutes les 2s).
**Ce n'est pas compatible avec une fonction serverless à durée de vie courte**
(Vercel classique, AWS Lambda standard) — l'historique de marc-andre-app
documente déjà deux 504 pour exactement cette raison côté app elle-même, ne
reproduis pas l'erreur ici. Héberge ce serveur comme un **process persistant** :
un petit conteneur/VM (Railway, Fly.io, Render, ou une petite instance chez le
même hébergeur que marc-andre-app). Le palier 1 seul (sans jobs longs)
tolérerait une fonction serverless classique, mais autant prévoir tout de
suite pour le palier 2.

## Deux couches d'authentification — ne pas les confondre

1. **Entrante** : qui a le droit d'appeler CE serveur MCP hébergé.
   `Authorization: Bearer <MCP_BEARER_TOKEN>` — à configurer côté Claude/Cowork
   comme connecteur MCP distant. Vérifié par `src/core/auth.ts`.
2. **Sortante** : ce serveur vers marc-andre-app.
   `Authorization: Bearer <MA_AGENT_KEY>` — clé dédiée à créer côté
   marc-andre-app au moment du GO (jamais `ADMIN_API_KEY`, voir PALIERS.md).

Ce serveur ne détient **aucun** secret de marc-andre-app au-delà de
`MA_AGENT_KEY` : pas de `ADMIN_API_KEY`, pas de jeton QuickBooks, pas
d'identifiants SharePoint.

## Geste d'urgence

`AGENT_ENABLED=false` dans les variables d'environnement coupe tout
immédiatement (503 sur chaque appel), sans redéploiement de code. C'est
l'équivalent du disjoncteur recommandé côté marc-andre-app pour `AGENT_ENABLED`
— les deux doivent exister, celui-ci protège la passerelle elle-même même si
la clé côté app reste active.

## Structure

```
src/
  config.ts          validation des variables d'env au démarrage (refuse de démarrer si secret manquant)
  server.ts           app Express + transport MCP Streamable HTTP
  index.ts            point d'entrée
  core/
    httpClient.ts      SEUL module qui fait du réseau vers marc-andre-app
    auth.ts            authentification entrante (bearer, temps constant)
    errors.ts          taxonomie d'erreurs, messages FR actionnables
    cache.ts           cache mémoire TTL (protège SharePoint/Graph du throttling)
    redact.ts          caviardage des secrets avant tout log
    logger.ts          journal JSONL local, second registre indépendant de l'audit applicatif
  confirm/intents.ts   jetons de confirmation à usage unique (palier 2)
  jobs/stepDriver.ts   pilote la boucle /step à la place du navigateur
  tools/
    types.ts           forme d'une définition d'outil
    registry.ts         L'allowlist — un outil absent d'ici n'existe pas pour Claude
    tier1/*.ts           lecture seule
    tier2/*.ts           écriture réversible, désactivé si MA_ALLOW_TIER2 !== 'true'
  schemas/, format/     validation d'entrée, élagage des réponses volumineuses
test/                  redact, cycle de vie des jetons de confirmation
```

## Invariants à respecter pour tout ajout d'outil

1. Aucun `fetch` en dehors de `core/httpClient.ts`.
2. Toute action irréversible (courriel, publication comptable) reste hors
   d'atteinte de cet agent (palier 3) — ou en palier 2 avec confirmation, jamais
   sans.
3. Chaque description d'outil porte ses limites dans son propre texte (cache,
   plafonds, avertissements sur la fiabilité des données) — c'est le seul
   mécanisme qui empêche Claude de présenter une approximation comme un fait.
4. Un nouvel outil = une entrée dans `PALIERS.md`, pas seulement dans le code.
