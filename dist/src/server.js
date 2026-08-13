import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { Logger } from './core/logger.js';
import { MarcAndreHttpClient } from './core/httpClient.js';
import { requireBearerAuth, requireAgentEnabled } from './core/auth.js';
import { registerAllTools } from './tools/registry.js';
import { sweepExpiredIntents } from './confirm/intents.js';
import { registerOAuthRoutes } from './oauth/authServer.js';
/**
 * Serveur hébergé (décision D9), transport MCP « Streamable HTTP ».
 *
 * ⚠️ Note de déploiement importante : les jobs du palier 2 (analyse QBO,
 * facturation) peuvent tourner plusieurs minutes (stepDriver pilote une
 * boucle à intervalle 2s, jusqu'à 20 min de budget). Ça ne correspond PAS
 * au modèle "fonction serverless courte" — l'historique de marc-andre-app
 * documente déjà deux 504 pour cette exact raison côté app elle-même. Ce
 * serveur doit tourner comme un PROCESS PERSISTANT (petit VM, container,
 * Railway/Fly/Render...), pas comme une fonction Vercel classique à
 * durée de vie courte. Voir README.md.
 */
export function createApp() {
    const config = loadConfig();
    const logger = new Logger(config.logFile);
    const http = new MarcAndreHttpClient(config, logger);
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: false }));
    // Nettoyage périodique des jetons de confirmation expirés.
    setInterval(sweepExpiredIntents, 60_000).unref();
    app.get('/healthz', (_req, res) => {
        res.json({ ok: true, tier2Enabled: config.allowTier2, agentEnabled: config.agentEnabled });
    });
    // Serveur d'autorisation OAuth minimal (voir src/oauth/authServer.ts) —
    // permet à l'UI "connecteur personnalisé" de Claude de s'authentifier
    // sans la fonction bêta "en-têtes de requête" (non activée sur ce compte).
    registerOAuthRoutes(app, config);
    const mcpRouter = express.Router();
    mcpRouter.use(requireAgentEnabled(config));
    mcpRouter.use(requireBearerAuth(config));
    mcpRouter.post('/', async (req, res) => {
        // Mode stateless : un serveur MCP neuf par requête, comme recommandé
        // par le SDK pour un déploiement HTTP sans affinité de session entre
        // requêtes. Les jetons de confirmation et le cache vivent au niveau du
        // process (modules confirm/intents.ts et core/cache.ts), pas ici.
        //
        // ⚠️ sessionIdGenerator DOIT être `undefined` ici, pas une fonction. Un
        // générateur signale au SDK le mode "stateful" (session à faire
        // persister entre requêtes), incompatible avec "un serveur neuf par
        // requête" : le deuxième appel (ex. tools/list après initialize) arrive
        // sur une transport toute neuve qui ne connaît pas la session déclarée
        // au premier appel, et le SDK le refuse avec "Server not initialized".
        // `undefined` = mode stateless réel, chaque requête traitée seule,
        // aucune session à faire correspondre.
        const server = new McpServer({ name: 'marc-andre-mcp', version: '0.1.0' });
        registerAllTools(server, config, http, logger);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    app.use('/mcp', mcpRouter);
    return { app, config, logger };
}
