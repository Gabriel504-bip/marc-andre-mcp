/**
 * Cache mémoire à durée de vie (TTL). Sert avant tout à protéger
 * marc-andre-app (donc SharePoint / Microsoft Graph / Asana / HubSpot en
 * amont) d'un agent qui interrogerait `ma_lister_clients` ou `ma_finance`
 * en boucle — un 429 Graph peut déconnecter des humains (bug documenté
 * dans lib/users.js côté marc-andre-app).
 *
 * Volontairement en mémoire process, pas distribué : ce serveur MCP est
 * censé tourner comme un service unique, pas une flotte d'instances.
 */
export class TtlCache {
    ttlMs;
    store = new Map();
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value;
    }
    set(key, value, ttlMsOverride) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + (ttlMsOverride ?? this.ttlMs),
        });
    }
    invalidate(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
