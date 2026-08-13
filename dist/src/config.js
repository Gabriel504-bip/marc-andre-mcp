/**
 * Lecture + validation des variables d'environnement au démarrage.
 *
 * Principe non négociable (voir expert-createur-logiciel) : on refuse de
 * démarrer plutôt que de dégrader silencieusement. Un secret manquant est
 * une erreur de configuration, pas un cas à "gérer gracieusement" en
 * démarrant quand même avec des permissions floues.
 */
function required(name) {
    const v = process.env[name];
    if (!v || v.trim() === '') {
        throw new Error(`[config] Variable d'environnement manquante ou vide : ${name}. ` +
            `Voir .env.example. Le serveur refuse de démarrer.`);
    }
    return v;
}
function optional(name, fallback) {
    const v = process.env[name];
    return v && v.trim() !== '' ? v : fallback;
}
function bool(name, fallback) {
    const v = process.env[name];
    if (v === undefined)
        return fallback;
    return v.trim().toLowerCase() === 'true';
}
function int(name, fallback) {
    const v = process.env[name];
    if (!v)
        return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
let cached = null;
export function loadConfig() {
    if (cached)
        return cached;
    const cfg = {
        mcpBearerToken: required('MCP_BEARER_TOKEN'),
        maBaseUrl: required('MA_BASE_URL').replace(/\/+$/, ''),
        maAgentKey: required('MA_AGENT_KEY'),
        maAgentId: optional('MA_AGENT_ID', 'claude-cowork-agent'),
        allowTier2: bool('MA_ALLOW_TIER2', false),
        agentEnabled: bool('AGENT_ENABLED', true),
        timeoutMs: int('MA_TIMEOUT_MS', 15000),
        cacheTtlMs: int('MA_CACHE_TTL_MS', 5 * 60 * 1000),
        logFile: optional('MA_LOG_FILE', './agent-actions.jsonl'),
        allowedClients: process.env.AGENT_ALLOWED_CLIENTS
            ? process.env.AGENT_ALLOWED_CLIENTS.split(',').map((s) => s.trim()).filter(Boolean)
            : null,
    };
    if (cfg.mcpBearerToken.length < 32) {
        throw new Error('[config] MCP_BEARER_TOKEN est trop court (< 32 caractères). Génère un secret plus long.');
    }
    // Piège rencontré en déploiement réel : un MA_BASE_URL sans "https://"
    // (ex. copié tronqué) ne provoque AUCUNE erreur au démarrage — fetch()
    // échoue seulement au premier appel d'outil, avec un message réseau vague
    // ("échec réseau après plusieurs tentatives") qui ne dit pas pourquoi.
    // On refuse de démarrer plutôt que de dégrader silencieusement jusqu'au
    // premier vrai appel.
    if (!/^https?:\/\//i.test(cfg.maBaseUrl)) {
        throw new Error(`[config] MA_BASE_URL doit commencer par http:// ou https:// (valeur reçue : "${cfg.maBaseUrl}"). ` +
            'Vérifie la variable dans les réglages Vercel — un copier-coller tronqué est la cause la plus fréquente.');
    }
    cached = cfg;
    return cfg;
}
