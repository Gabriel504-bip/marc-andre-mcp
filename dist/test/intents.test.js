import { describe, it, expect } from 'vitest';
import { createIntent, consumeIntent } from '../src/confirm/intents.js';
import { ConfirmationError } from '../src/core/errors.js';
describe('confirm/intents', () => {
    it('accepte un jeton valide avec les mêmes paramètres', () => {
        const params = { sessionToken: 'abc', from: '2026-01-01', to: '2026-01-31' };
        const token = createIntent('qbo_analyse', params, { ok: true });
        const payload = consumeIntent('qbo_analyse', params, token);
        expect(payload).toEqual({ ok: true });
    });
    it('refuse un jeton déjà consommé (usage unique)', () => {
        const params = { a: 1 };
        const token = createIntent('x', params, {});
        consumeIntent('x', params, token);
        expect(() => consumeIntent('x', params, token)).toThrow(ConfirmationError);
    });
    it('refuse si les paramètres ont changé depuis la préparation', () => {
        const token = createIntent('x', { a: 1 }, {});
        expect(() => consumeIntent('x', { a: 2 }, token)).toThrow(ConfirmationError);
    });
    it('refuse un jeton inconnu', () => {
        expect(() => consumeIntent('x', {}, 'jeton-inexistant')).toThrow(ConfirmationError);
    });
});
