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
| `ma_ecriture_manuelle_creer` (2026-08-15, révisé le même jour — correctif architectural après 2 publications réelles non désirées) | crée 1 à 25 écritures de journal manuelles libres par appel (ex. DAS fédéral) et les **dépose dans le module Écritures de marc-andre-app** (comme `ma_conciliation_exercice_vers_ecritures`) — ne publie JAMAIS dans QuickBooks elle-même. CSV séparé par virgules, dates JJ/MM/AAAA, `timeoutMs` 300 s. | oui — aucun effet QuickBooks direct. Simulation VRAIE par défaut + `reference` obligatoire PAR écriture (idempotence) + refuse tout compte GL manquant plutôt que d'en créer un. Échec d'un élément du lot n'affecte pas les autres. |
| `ma_ecriture_manuelle_publier` (2026-08-15, ajouté le même jour, demande explicite de Gabriel) | publie **réellement dans QuickBooks** des écritures déjà déposées par l'outil ci-dessus (par `reference`), en réutilisant EXACTEMENT la même fonction que le clic humain « Approuver » (`publierEcritureManuelleMultiligne`, `lib/qbo-analysis.js`) — aucune logique QBO nouvelle. | **non — irréversible.** Voir « Amendement — `ma_ecriture_manuelle_publier` » ci-dessous : `confirmation` forcée à `false` sauf valeur booléenne EXACTE `true` (imposée après le spread côté passerelle) + `QBO_WRITE_ENABLED` (hors de portée de l'agent) + idempotent par référence (une référence déjà publiée n'est jamais republiée). |

| `ma_qbo_taxe_transaction_modifier` (2026-08-15, demande explicite de Gabriel) | modifie le traitement de taxe d'une transaction QuickBooks **déjà existante** : menu « Affichage des montants » (`GlobalTaxCalculation`) et/ou code de taxe des lignes. Relit avant ET après, compare les totaux. | **non — irréversible.** `confirmation` forcée à `false` sauf `true` EXACT (imposée après le spread côté passerelle) + `QBO_WRITE_ENABLED` + SyncToken relu juste avant l'écriture + relecture de vérification. Signale explicitement toute dérive du TOTAL (précédent v2.37.1 : « Taxe comprise » avait ajouté la taxe au lieu de l'extraire, 120,00 $ -> 137,97 $). |

| `ma_qbo_revenus_sans_taxe` (2026-08-16) — **palier 1**, listé ici pour le contexte | rapport en LECTURE SEULE des transactions de revenu sans taxe sur une période (Reçus de vente, Factures, Notes de crédit, Remboursements, Dépôts et Écritures de journal touchant un compte de revenu). | oui — aucun effet. Expose un bloc `couverture` (transactions lues par type) pour que la complétude soit vérifiable par recoupement, et `tronque` si la borne de lecture est atteinte. |
| `ma_qbo_taxe_lot_appliquer` (2026-08-16, demande de Gabriel : 433 dépôts à corriger) | applique un code de taxe **en lot** aux transactions de revenu d'une période, en préservant le montant bancaire de chacune. | **non — irréversible**, mêmes verrous que l'outil unitaire (`confirmation` fausse par défaut + `QBO_WRITE_ENABLED`), plus : réponse compacte, budget de temps sous la limite de la fonction, et **reprise sans registre** (une transaction déjà traitée porte le code, le balayage ne la retrouve plus). Toute dérive de total est listée nommément dans `alertesTotalModifie`. |

| `ma_qbo_lire` (2026-08-16) — **palier 1**, listé ici pour le contexte | lecture LIBRE de QuickBooks : n'importe quelle requête SELECT, ou une entité par Id. | oui — aucun effet. Refuse tout verbe autre que SELECT, borne MAXRESULTS, tronque avec drapeau explicite plutôt que de saturer la session. |
| `ma_qbo_taxe_lot_corriger_sens` (2026-08-16) | bascule EN LOT le côté du registre (ventes/achats) des transactions déjà taxées. | **non — irréversible**, mais AUCUN montant n'est réécrit : seul `TaxApplicableOn` change, donc aucun appariement bancaire n'est menacé. Vérifie que le total n'a pas bougé ET que le côté a réellement été appliqué. |
| `ma_qbo_ecrire` (2026-08-16, demande de Gabriel : « aucune limite sur l'API ») | crée, modifie ou supprime **n'importe quelle** entité QuickBooks. Aucune limite de capacité. | **non — irréversible.** Voir « Amendement — `ma_qbo_ecrire` » ci-dessous. `confirmation` fausse par défaut + `QBO_WRITE_ENABLED` + SyncToken toujours relu côté serveur + relecture de vérification après écriture. |

| `ma_qbo_rapport` (2026-08-17) — **palier 1**, listé ici pour le contexte | sort n'importe quel rapport QuickBooks (état des résultats, bilan, balance de vérification, grand livre, sommaire de taxes...). Comble un trou réel : les rapports vivent sur un autre point d'entrée de l'API, inaccessible aux requêtes SELECT. | oui — aucun effet. Réponse aplatie et plafonnée par défaut. |
| `ma_releve_deposer` (2026-08-17) | dépose dans la session d'un client un relevé bancaire LU en conversation (transactions structurées, pas le fichier). | oui côté QuickBooks — **n'y touche jamais**. Écrit un fichier d'extraction dans la session. Le garde-fou n'est pas une confirmation mais le CONTRÔLE DE BALANCE : `soldeOuverture`/`soldeFermeture` obligatoires, balance recalculée et chaîne des soldes reconstruite, de sorte qu'une extraction incomplète ne peut pas passer pour bonne. Refuse d'écraser une extraction existante sans `remplacer: true`. |

### Amendement — `ma_qbo_ecrire` (2026-08-16)

Demande explicite de Gabriel : « je veux qu'avec la connexion de Claude via
Marc André il n'y ait aucune limite sur l'API ». Cet outil abolit donc la
liste blanche par entité : tout ce que QuickBooks accepte est faisable.

La justification est solide — pendant toute une journée, chaque donnée
manquante a exigé de construire un outil étroit, de le déployer, puis
d'attendre que le connecteur le reprenne, alors que l'information existait
déjà côté QuickBooks.

Ce qui N'a PAS été retiré, et pourquoi. Les deux garde-fous conservés sont
exactement ceux qui ont évité les deux accidents du 2026-08-16 :

  1. **Aperçu par défaut** — l'aperçu a montré 4 671 transactions au lieu de
     436 avant une inversion en lot, évitant de détruire la taxe légitime de
     plus de 4 200 transactions d'un vrai client.
  2. **Relecture après écriture** — c'est elle qui a attrapé la dérive du
     dépôt 483 (145,00 $ devenu 166,71 $) au moment où elle s'est produite,
     plutôt que des mois plus tard dans un rapport de taxe.

La leçon retenue de cette journée n'est pas « restreindre les capacités »,
c'est « ne jamais écrire sans avoir vu ce qui partira, ni sans relire ce qui
est arrivé ».

### Amendement — `ma_ecriture_manuelle_publier` (2026-08-15)

Le geste « publier réellement dans QuickBooks » (`qbo-jobs/review` action
`approve`) est décrit ci-dessous comme jamais un outil MCP. `ma_ecriture_
manuelle_publier` en est une exception délibérée, demandée explicitement par
Gabriel le 2026-08-15 (même précédent que l'amendement déjà en place pour
`ma_correctifs_appliquer`, qui permet la suppression réelle d'écritures QBO
depuis un outil MCP) : la frontière ne disparaît pas, elle se déplace derrière
deux verrous indépendants (`confirmation` forcée fausse par défaut côté
passerelle + `QBO_WRITE_ENABLED` hors de portée de l'agent), et ne s'applique
QU'à des écritures déjà déposées et visibles dans le module Écritures — jamais
à une écriture arbitraire non revue.

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
