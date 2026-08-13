/**
 * Taxonomie d'erreurs. Chaque erreur porte un message FRANÇAIS,
 * ACTIONNABLE, jamais l'erreur brute d'origine (qui reste dans `.cause`
 * pour le journal local, mais n'est jamais renvoyée telle quelle à Claude).
 */

export class AgentError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}

export class AuthError extends AgentError {
  constructor(message = 'Authentification refusée.', options?: { cause?: unknown }) {
    super('AUTH_ERROR', message, options);
  }
}

export class ToolNotAllowedError extends AgentError {
  constructor(tool: string) {
    super(
      'TOOL_NOT_ALLOWED',
      `L'outil « ${tool} » n'existe pas ou n'est pas autorisé dans la configuration actuelle ` +
        `(vérifie MA_ALLOW_TIER2 si c'est un outil du palier 2).`
    );
  }
}

export class ValidationError extends AgentError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('VALIDATION_ERROR', message, options);
  }
}

export class PreconditionError extends AgentError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('PRECONDITION_ERROR', message, options);
  }
}

export class UpstreamTimeoutError extends AgentError {
  constructor(tool: string, timeoutMs: number) {
    super(
      'UPSTREAM_TIMEOUT',
      `marc-andre-app n'a pas répondu à temps pour « ${tool} » (${timeoutMs} ms). ` +
        `Réessaie dans un instant — si ça persiste, le service est peut-être en panne.`
    );
  }
}

export class UpstreamError extends AgentError {
  constructor(tool: string, status: number, detail: string, options?: { cause?: unknown }) {
    super(
      'UPSTREAM_ERROR',
      `marc-andre-app a refusé l'appel « ${tool} » (HTTP ${status}) : ${detail}`,
      options
    );
  }
}

export class ConfirmationError extends AgentError {
  constructor(message: string) {
    super('CONFIRMATION_ERROR', message);
  }
}

/** Convertit n'importe quelle erreur en texte affichable à Claude, sans fuite de détails internes. */
export function toDisplayMessage(err: unknown): string {
  if (err instanceof AgentError) return err.message;
  if (err instanceof Error) return `Erreur inattendue : ${err.message}`;
  return 'Erreur inattendue.';
}
