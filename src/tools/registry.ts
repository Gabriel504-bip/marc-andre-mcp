import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import type { MarcAndreHttpClient } from '../core/httpClient.js';
import type { Logger } from '../core/logger.js';
import { ToolNotAllowedError, toDisplayMessage } from '../core/errors.js';
import type { ToolContext, ToolDefinition } from './types.js';

import { tier1ClientTools } from './tier1/clients.js';
import { tier1EcrituresTools } from './tier1/ecritures.js';
import { tier1QuickbooksTools } from './tier1/quickbooks.js';
import { tier1AdminTools } from './tier1/admin.js';
import { tier1ConciliationTools } from './tier1/conciliation.js';

import { tier2QboTools } from './tier2/qboAnalyse.js';
import { tier2FacturationTools } from './tier2/facturation.js';
import { tier2RelanceTools } from './tier2/relance.js';
import { tier2ConciliationTools } from './tier2/conciliation.js';
import { tier2CorrectifsTools } from './tier2/correctifs.js';
import { tier2EcritureManuelleTools } from './tier2/ecritureManuelle.js';

/**
 * UNE seule allowlist, codée en dur (§2.2/§2.4). Un outil absent de cette
 * table n'existe pas pour Claude — pas de 404 en aval à masquer, il n'est
 * simplement jamais enregistré sur le serveur MCP.
 *
 * Le palier 2 n'est ajouté à la liste que si config.allowTier2 === true :
 * les outils ne sont pas "présents mais refusés", ils sont ABSENTS du
 * catalogue. Claude ne peut pas être tenté par un outil qu'il ne voit pas.
 */
export function buildToolList(config: Config): ToolDefinition[] {
  const tier1 = [
    ...tier1ClientTools,
    ...tier1EcrituresTools,
    ...tier1QuickbooksTools,
    ...tier1AdminTools,
    ...tier1ConciliationTools,
  ];

  if (!config.allowTier2) return tier1;

  return [
    ...tier1,
    ...tier2QboTools,
    ...tier2FacturationTools,
    ...tier2RelanceTools,
    ...tier2ConciliationTools,
    ...tier2CorrectifsTools,
    ...tier2EcritureManuelleTools,
  ];
}

function checkClientAllowlist(config: Config, input: unknown): void {
  if (!config.allowedClients) return;
  const st = (input as any)?.sessionToken;
  if (st && !config.allowedClients.includes(st)) {
    throw new ToolNotAllowedError(
      `sessionToken hors de la liste pilote AGENT_ALLOWED_CLIENTS (décision D8)`
    );
  }
}

export function registerAllTools(
  server: McpServer,
  config: Config,
  http: MarcAndreHttpClient,
  logger: Logger
): void {
  const tools = buildToolList(config);

  for (const def of tools) {
    server.registerTool(
      def.name,
      {
        title: def.name,
        description: `[palier ${def.tier}${def.requiresAdmin ? ', requireAdmin côté app' : ''}] ${def.description}`,
        inputSchema: def.inputSchema as any,
      },
      async (input: unknown) => {
        const requestId = randomUUID();
        const ctx: ToolContext = { http, logger, config, requestId };

        try {
          checkClientAllowlist(config, input);

          await logger.info('tool_call_start', { tool: def.name, requestId });

          const result = def.localHandler
            ? await def.localHandler(input, ctx)
            : await (async () => {
                const raw = await http.invoke(def.action, input, requestId, {
                  ...(def.timeoutMs ? { timeoutMs: def.timeoutMs } : {}),
                });
                return def.postProcess ? await def.postProcess(raw, input, ctx) : raw;
              })();

          await logger.info('tool_call_success', { tool: def.name, requestId });

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          await logger.error('tool_call_error', {
            tool: def.name,
            requestId,
            message: toDisplayMessage(err),
          });
          return {
            content: [{ type: 'text' as const, text: `Erreur : ${toDisplayMessage(err)}` }],
            isError: true,
          };
        }
      }
    );
  }

  logger.info('tools_registered', {
    count: tools.length,
    tier2Enabled: config.allowTier2,
    names: tools.map((t) => t.name),
  });
}
