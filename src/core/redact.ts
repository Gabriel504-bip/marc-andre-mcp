/**
 * Caviardage récursif des secrets/PII avant tout log. Testé unitairement
 * (test/redact.test.ts) — aucun secret ne doit franchir le logger.
 */

const SENSITIVE_KEY_PATTERN =
  /token|key|secret|password|authorization|bearer|adminkey|staff/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[tronqué]';

  if (typeof value === 'string') {
    // Redacte aussi les jetons qui traînent dans une chaîne libre
    // (ex: une URL avec ?adminKey=... collée dans un message d'erreur amont).
    return value.replace(/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_[REDACTED]');
  }

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }

  return value;
}
