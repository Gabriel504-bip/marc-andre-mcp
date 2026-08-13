import { createApp } from './server.js';
const PORT = Number(process.env.PORT ?? 8787);
const { app, config, logger } = createApp();
app.listen(PORT, () => {
    logger.info('server_started', {
        port: PORT,
        tier2Enabled: config.allowTier2,
        agentEnabled: config.agentEnabled,
        maBaseUrl: config.maBaseUrl,
    });
    // eslint-disable-next-line no-console
    console.error(`marc-andre-mcp à l'écoute sur :${PORT} (endpoint MCP : /mcp)`);
});
