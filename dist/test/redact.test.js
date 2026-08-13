import { describe, it, expect } from 'vitest';
import { redact } from '../src/core/redact.js';
describe('redact', () => {
    it('masque les clés sensibles', () => {
        const out = redact({ adminKey: 'abc', staffToken: 'xyz', name: 'Marcel' });
        expect(out.adminKey).toBe('[REDACTED]');
        expect(out.staffToken).toBe('[REDACTED]');
        expect(out.name).toBe('Marcel');
    });
    it('masque un token GitHub trouvé dans une chaîne libre', () => {
        const out = redact('erreur: github_pat_11CF2FNEI0DQLduy7bMnH5b2cBhZxPXyLqcQOJEraTlPo0w');
        expect(out).not.toContain('11CF2F');
        expect(out).toContain('[REDACTED]');
    });
    it('descend récursivement dans les objets imbriqués et les tableaux', () => {
        const out = redact({ list: [{ password: 'secret', ok: true }] });
        expect(out.list[0].password).toBe('[REDACTED]');
        expect(out.list[0].ok).toBe(true);
    });
});
