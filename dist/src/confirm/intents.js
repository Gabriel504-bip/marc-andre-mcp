import { createHash, randomUUID } from 'node:crypto';
import { ConfirmationError } from '../core/errors.js';
const TTL_MS = 10 * 60 * 1000;
const store = new Map();
function hashParams(action, params) {
    return createHash('sha256')
        .update(action)
        .update('|')
        .update(JSON.stringify(params))
        .digest('hex');
}
export function createIntent(action, params, payload) {
    const token = randomUUID();
    store.set(token, {
        hash: hashParams(action, params),
        payload,
        createdAt: Date.now(),
        consumed: false,
    });
    return token;
}
export function consumeIntent(action, params, token) {
    const intent = store.get(token);
    if (!intent) {
        throw new ConfirmationError("Jeton de confirmation inconnu ou déjà utilisé. Relance l'étape de préparation.");
    }
    if (intent.consumed) {
        throw new ConfirmationError('Ce jeton a déjà été utilisé (usage unique).');
    }
    if (Date.now() - intent.createdAt > TTL_MS) {
        store.delete(token);
        throw new ConfirmationError('Ce jeton de confirmation a expiré (10 minutes). Relance l\'étape de préparation.');
    }
    if (intent.hash !== hashParams(action, params)) {
        throw new ConfirmationError('Les paramètres fournis ne correspondent plus à ce qui a été proposé. ' +
            "Relance l'étape de préparation avec les paramètres exacts que tu veux exécuter.");
    }
    intent.consumed = true;
    store.delete(token);
    return intent.payload;
}
/** Nettoyage périodique — évite une fuite mémoire lente sur un process long-lived. */
export function sweepExpiredIntents() {
    const now = Date.now();
    for (const [token, intent] of store) {
        if (now - intent.createdAt > TTL_MS)
            store.delete(token);
    }
}
