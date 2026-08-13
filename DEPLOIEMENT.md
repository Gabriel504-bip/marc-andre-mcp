# Déploiement de `marc-andre-mcp` — À LIRE AVANT TOUT PUSH

## Le piège (incident du 2026-08-13, connecteur MCP tombé)

`vercel.json` utilise la configuration **legacy `builds`**. Conséquence documentée par Vercel
lui-même dans les journaux de build :

```
WARNING! Due to `builds` existing in your configuration file, the Build and
Development Settings defined in your Project Settings will not apply.
```

Autrement dit : **Vercel ne lance JAMAIS `npm run build`** sur ce projet. Le journal d'un build
réel se résume à « Installing dependencies... up to date in 1s ». Aucun `tsc`.

Or `api/[...path].js` fait `import { createApp } from '../dist/src/server.js'`. Si `dist/`
n'est pas présent dans les fichiers déployés, la fonction **plante à l'import** et le serveur
MCP ne répond plus du tout (« The connector's server isn't responding »).

### Pourquoi ça marchait avant

Les déploiements qui fonctionnaient étaient faits **depuis le PC de Gabriel** avec
`vercel --prod`. Le journal le montre : « Retrieving list of deployment files... Downloading 70
deployment files » — la CLI téléverse le contenu du dossier local, `dist/` compilé inclus,
même si `dist/` est dans `.gitignore` (la CLI suit `.vercelignore`, pas `.gitignore`).

Un **push GitHub**, lui, clone le dépôt. Si `dist/` est gitignoré, il n'existe pas → déploiement
cassé. C'est exactement ce qui s'est produit le 2026-08-13 : un push a mis le connecteur hors
service alors que le code source, lui, était correct et testé.

## La règle, donc

**`dist/` est volontairement COMMITÉ dans ce dépôt** (retiré de `.gitignore`). Ce n'est pas
élégant — du code compilé dans git ne l'est jamais — mais c'est la seule chose qui rend les
deux chemins de déploiement équivalents et sûrs :

| Chemin | Fonctionne ? |
|---|---|
| `git push origin main` (auto-déploiement) | ✅ oui, `dist/` est dans le dépôt |
| `vercel --prod` depuis le PC | ✅ oui, comme avant |

### Avant CHAQUE commit qui touche `src/`

```bash
npm test          # doit être vert
npm run build     # régénère dist/ — OBLIGATOIRE
git add -A        # inclut dist/
git commit ...
git push origin main
```

**Si tu oublies `npm run build`**, tu déploies l'ancien code compilé : aucune erreur visible,
juste ton correctif qui « ne fait rien ». C'est le même genre d'échec muet que le bug
`decisionsAmbigus` corrigé ce jour-là.

## Le vrai correctif, si on veut faire mieux plus tard

Remplacer la configuration legacy par une moderne, pour que Vercel compile lui-même :

```json
{
  "buildCommand": "npm run build",
  "rewrites": [{ "source": "/(.*)", "destination": "/api/[...path]" }]
}
```

`dist/` pourrait alors redevenir gitignoré. **Non appliqué volontairement** : ça change la
plomberie de déploiement d'un service en production, et ça ne se valide pas depuis un bac à
sable — chaque essai est un déploiement en direct. À faire un jour où le connecteur peut
tomber sans conséquence, en vérifiant le journal de build (on doit y voir `tsc`) et un appel
MCP réel après coup.
