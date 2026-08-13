import { createHash, randomUUID } from 'node:crypto';
import { ConfirmationError } from '../core/errors.js';

/**
 * Jetons de confirmation pour le palier 2 (§4.2 du rapport d'architecture).
 *
 * Flux en deux temps : `*_preparer` retourne un plan + un jeton ; Gabriel
 * confirme dans la conversation (décision D2 : confirmation conversationnelle
 * seule, pas de double clic dans l'app pour l'instant) ; `*_executer` exige
 * ce jeton.
 *
 * Pourquoi un jeton plutôt qu'un simple « tu es sûr ? » conversationnel :
 * ça rend la confirmation vérifiable côté machine. Claude ne peut pas
 * « décider » qu'il a déjà demandé, et si les paramètres changent d'un
 * iota entre la proposition et l'exécution, le jeton devient invalide —
 * Gabriel approuve exactement ce qui sera fait, jamais une version voisine.
 *
 * En mémoire process uniquement : un redémarrage du serveur invalide les
 * confirmations en attente, ce qui est le comportement voulu (pas de faux
 * sentiment de continuité après un redéploiement).
 */

interface Intent {
  hash: string;
  payload: unknown;
  createdAt: number;
  consumed: boolean;
}

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, Intent>();

function hashParams(action: string, params: unknown): string {
  return createHash('sha256')
    .update(action)
    .update('|')
    .update(JSON.stringify(params))
    .digest('hex');
}

export function createIntent(action: string, params: unknown, payload: unknown): string {
  const token = randomUUID();
  store.set(token, {
    hash: hashParams(action, params),
    payload,
    createdAt: Date.now(),
    consumed: false,
  });
  return token;
}

export function consumeIntent(action: string, params: unknown, token: string): unknown {
  const intent = store.get(token);

  if (!intent) {
    throw new ConfirmationError(
      "Jeton de confirmation inconnu ou déjà utilisé. Relance l'étape de préparation."
    );
  }
  if (intent.consumed) {
    throw new ConfirmationError('Ce jeton a déjà été utilisé (usage unique).');
  }
  if (Date.now() - intent.createdAt > TTL_MS) {
    store.delete(token);
    throw new ConfirmationError(
      'Ce jeton de confirmation a expiré (10 minutes). Relance l\'étape de préparation.'
    );
  }
  if (intent.hash !== hashParams(action, params)) {
    throw new ConfirmationError(
      'Les paramètres fournis ne correspondent plus à ce qui a été proposé. ' +
        "Relance l'étape de préparation avec les paramètres exacts que tu veux exécuter."
    );
  }

  intent.consumed = true;
  store.delete(token);
  return intent.payload;
}

/** Nettoyage périodique — évite une fuite mémoire lente sur un process long-lived. */
export function sweepExpiredIntents(): void {
  const now = Date.now();
  for (const [token, intent] of store) {
    if (now - intent.createdAt > TTL_MS) store.delete(token);
  }
}
