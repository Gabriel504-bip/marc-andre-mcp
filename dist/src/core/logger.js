import { appendFile } from 'node:fs/promises';
import { redact } from './redact.js';
export class Logger {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async write(entry) {
        const safe = redact(entry);
        const line = JSON.stringify(safe) + '\n';
        process.stderr.write(line);
        try {
            await appendFile(this.filePath, line, 'utf8');
        }
        catch {
            // Le journal local ne doit jamais faire échouer l'action métier
            // appelante — même règle que logAction() côté marc-andre-app.
        }
    }
    info(event, data = {}) {
        return this.write({ ts: new Date().toISOString(), level: 'info', event, ...data });
    }
    warn(event, data = {}) {
        return this.write({ ts: new Date().toISOString(), level: 'warn', event, ...data });
    }
    error(event, data = {}) {
        return this.write({ ts: new Date().toISOString(), level: 'error', event, ...data });
    }
}
