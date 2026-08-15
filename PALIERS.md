# Paliers de risque — marc-andre-mcp

Document de gouvernance, pas technique : pour chaque outil, ce qu'il touche et ce
qu'il ne touche PAS. À relire avant tout ajout d'outil.

## Palier 1 — lecture seule (actif dès le premier déploiement)

| Outil | Action sous-jacente | Effet |
|---|---|---|
| `ma_chercher_client` | `chercher_client` | aucun — lecture |
| `ma_lister_clients` | `lister_clients` | aucun — lecture, élaguée |
| `ma_fiche_client` | `fiche_client` | aucun — lecture, élaguée par sections |
| `ma_ecritures` | `ecritures` | aucun — lecture |
| `ma_statut_job` | `statut_job` | aucun — lecture |
| `ma_qbo_statut` | `qbo_statut` | aucun — lecture, jamais de jeton QBO |
| `ma_qbo_listes_reference` | `qbo_listes_reference` | aucun côté agent — note : la route sous-jacente peut rafraîchir un jeton QBO en arrière-plan (bénin, déjà en production) |
| `ma_finance` | `finance` (requireAdmin) | aucun — lecture, chiffres à traiter comme estimations |
| `ma_taches_equipe` | `taches_equipe` (requireAdmin) | aucun — lecture, lien client heuristique |
| `ma_journal_audit` | `journal_audit` (requireAdmin) | aucun — lecture |
| `ma_accueil_synthese` | `accueil_synthese` | aucun — lecture |

## Palier 2 — écriture réversible (FERMÉ par défaut, `MA_ALLOW_TIER2=false`)

Confirmation en deux temps (`*_preparer` → `confirmation_token` → `*_executer`),
conversationnelle uniquement (décision D2, 2026-08-12 — pas de double clic dans
l'app pour l'instant).

| Outil | Effet réel | Réversible ? |
|---|---|---|
| `ma_qbo_analyse_preparer` / `_executer` / `_progression` | lance une analyse QBO (lecture QBO + écriture de propositions dans marc-andre-app) | oui — n'écrit rien dans QuickBooks |
| `ma_facturation_apercu` / `ma_facturation_rapprocher_executer` | rapprochement de facturation, déterministe | oui — persistance uniquement côté marc-andre-app, pas QBO |
| `ma_relance_preparer` / `ma_relance_executer` | **envoie un vrai courriel** (sauf si SAFE_MODE_EMAIL actif) | **non** — irréversible, garde-fou anti-doublon 24h |
| `ma_ecriture_manuelle_creer` (2026-08-15, corrigé le même jour après 7 essais réels) | crée 1 à 25 écritures de journal manuelles libres par appel et les **publie réellement dans QuickBooks** (ex. DAS fédéral). CSV séparé par virgules, dates JJ/MM/AAAA, `timeoutMs` 300 s. | oui en pratique (annulable manuellement dans QuickBooks) mais PUBLIÉE directement — pas seulement déposée en révision comme la conciliation. Simulation VRAIE par défaut + `reference` obligatoire PAR écriture (idempotence) + refuse tout compte GL manquant plutôt que d'en créer un. Échec d'un élément du lot n'affecte pas les autres. |

## Palier 3 — jamais un outil MCP exécutable (aucune exception)

Auth/comptes (`login`, `register`, `reset-password`, `verify-2fa`, `invite`,
`update-user`), statut/classement client (`set-client-status`, `set-client-type`,
`set-responsable`, `archive`), cycle de vie (`activate`, `create-session`),
signature (`docusign-resend`), connecteurs (`quickbooks/connect|disconnect`),
envois sortants autres que la relance encadrée (`demande-marc-andre`,
`request-documents`, `recurring/*`), et surtout **`qbo-jobs/review` avec
`action:'approve'`** — c'est le geste qui publie réellement dans QuickBooks ou
envoie un courriel à un client/fournisseur. Reste sous le doigt d'un humain,
dans l'app, point final.

## Décisions prises (2026-08-12)

- **D1** — clé agent unique (`MA_AGENT_KEY`), pas de clé par personne pour l'instant.
- **D2** — confirmation conversationnelle seule pour le palier 2, pas de double clic dans l'app.
- **D9** — serveur hébergé à distance (pas stdio local) → nécessite `MCP_BEARER_TOKEN` pour l'accès entrant, et un process persistant (pas une fonction serverless courte — voir README, jobs longue durée).
- **D10** — palier 2 fermé au premier déploiement (`MA_ALLOW_TIER2=false`).

## Décisions encore ouvertes

- **D3** — champ `onBehalfOf` obligatoire sur chaque appel ?
- **D4** — `admin/list-users` lisible par l'agent (name/email/role/status seulement) ?
- **D5** — `qbo-jobs/review` actions `archive`/`modify` (sans effet réel) en palier 2 ?
- **D6** — comment les CSV de facturation arrivent au serveur MCP (ce squelette suppose `content` déjà décodé, fourni par Claude) ?
- **D7** — exposer `rapportFinancierQbo`/`requeteQbo` (lecture QBO directe, garde-fou déjà en prod dans le chat interne) ?
- **D8** — `AGENT_ALLOWED_CLIENTS` pour une phase pilote sur 1-2 dossiers avant d'ouvrir tout le cabinet ?
- **D11** — politique de rotation de `MA_AGENT_KEY` et de `MCP_BEARER_TOKEN` ?
- **D12** — confirmé : `force` jamais transmis à `ma_finance`/`ma_taches_equipe` sans demande explicite.
