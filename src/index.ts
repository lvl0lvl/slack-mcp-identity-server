#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { SlackClient } from "./slack-client.js";
import { loadAgentConfig } from "./identity.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerReactionTools } from "./tools/reactions.js";
import { registerPinTools } from "./tools/pins.js";
import { registerUserTools } from "./tools/users.js";
import type { AgentConfig } from "./types.js";

export function createSlackServer(slackClient: SlackClient, agentConfig: AgentConfig | null = null, userToken?: string): McpServer {
  const server = new McpServer({
    name: "Slack MCP Server",
    version: "1.0.0",
  });

  registerChannelTools(server, slackClient);
  registerMessageTools(server, slackClient, agentConfig, userToken);
  registerPinTools(server, slackClient);
  registerReactionTools(server, slackClient);
  registerUserTools(server, slackClient);

  return server;
}

async function runStdioServer(slackClient: SlackClient, agentConfig: AgentConfig | null, userToken?: string) {
  console.error("Starting Slack MCP Server with stdio transport...");
  const server = createSlackServer(slackClient, agentConfig, userToken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Slack MCP Server running on stdio");
}

async function runHttpServer(slackClient: SlackClient, port: number = 3000, authToken?: string, agentConfig: AgentConfig | null = null, userToken?: string) {
  console.error(`Starting Slack MCP Server with Streamable HTTP transport on port ${port}...`);

  const { default: express } = await import("express");
  const app = express();
  app.use(express.json());

  const authMiddleware = (req: any, res: any, next: any) => {
    if (!authToken) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unauthorized: Missing or invalid Authorization header',
        },
        id: null,
      });
    }

    const token = authHeader.substring(7);
    if (token !== authToken) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unauthorized: Invalid token',
        },
        id: null,
      });
    }

    next();
  };

  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  app.post('/mcp', authMiddleware, async (req: any, res: any) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && req.body?.method === 'initialize') {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            transports[sessionId] = transport;
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };

        const server = createSlackServer(slackClient, agentConfig, userToken);
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  const handleSessionRequest = async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  };

  app.get('/mcp', authMiddleware, handleSessionRequest);
  app.delete('/mcp', authMiddleware, handleSessionRequest);

  app.get('/health', (_req: any, res: any) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'Slack MCP Server',
      version: '1.0.0'
    });
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.error(`Slack MCP Server running on http://0.0.0.0:${port}/mcp`);
  });

  return server;
}

export function parseArgs() {
  const args = process.argv.slice(2);
  let transport = 'stdio';
  let port = 3000;
  let authToken: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transport' && i + 1 < args.length) {
      transport = args[i + 1];
      i++;
    } else if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--token' && i + 1 < args.length) {
      authToken = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: slack-mcp-identity-server [options]

Options:
  --transport <type>     Transport type: 'stdio' or 'http' (default: stdio)
  --port <number>        Port for HTTP server (default: 3000)
  --token <token>        Bearer token for HTTP authorization (optional, can also use AUTH_TOKEN env var)
  --help, -h             Show this help message

Environment Variables:
  SLACK_BOT_TOKEN        Bot token (xoxb-) — required
  SLACK_TEAM_ID          Workspace ID — required
  SLACK_CHANNEL_IDS      Comma-separated channel IDs to restrict access (optional)
  SLACK_AGENT_CONFIG_PATH  Path to agent identity JSON config file (optional)
  AUTH_TOKEN             Bearer token for HTTP authorization (fallback if --token not provided)
`);
      process.exit(0);
    }
  }

  if (transport !== 'stdio' && transport !== 'http') {
    console.error('Error: --transport must be either "stdio" or "http"');
    process.exit(1);
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('Error: --port must be a valid port number (1-65535)');
    process.exit(1);
  }

  return { transport, port, authToken };
}

export async function main() {
  const { transport, port, authToken } = parseArgs();

  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!botToken || !process.env.SLACK_TEAM_ID) {
    console.error(
      "Please set SLACK_BOT_TOKEN and SLACK_TEAM_ID environment variables",
    );
    process.exit(1);
  }

  const slackClient = new SlackClient(botToken);

  try {
    const authResult = await slackClient.authTest();
    if (authResult.ok) {
      console.error(`Authenticated as "${authResult.user}" for team "${authResult.team}"`);
    } else {
      console.error(`auth.test failed: ${authResult.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error("Failed to validate bot token:", err);
    process.exit(1);
  }

  const agentConfig = loadAgentConfig();
  if (process.env.SLACK_AGENT_CONFIG_PATH && !agentConfig) {
    console.error(`Warning: SLACK_AGENT_CONFIG_PATH is set but agent config could not be loaded`);
  }
  if (agentConfig) {
    console.error(`Agent identity config loaded with ${Object.keys(agentConfig.agents).length} agent(s)`);
  }

  const userToken = process.env.SLACK_USER_TOKEN;

  let httpServer: any = null;

  const setupGracefulShutdown = () => {
    const shutdown = (signal: string) => {
      console.error(`\nReceived ${signal}. Shutting down gracefully...`);

      if (httpServer) {
        httpServer.close(() => {
          console.error('HTTP server closed.');
          process.exit(0);
        });

        setTimeout(() => {
          console.error('Forcing shutdown...');
          process.exit(1);
        }, 5000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGQUIT', () => shutdown('SIGQUIT'));
  };

  setupGracefulShutdown();

  if (transport === 'stdio') {
    await runStdioServer(slackClient, agentConfig, userToken);
  } else if (transport === 'http') {
    let finalAuthToken = authToken || process.env.AUTH_TOKEN;
    if (!finalAuthToken) {
      finalAuthToken = randomUUID();
      console.error(`Generated auth token: ${finalAuthToken}`);
      console.error('Use this token in the Authorization header: Bearer ' + finalAuthToken);
    } else if (authToken) {
      console.error('Using provided auth token for authorization');
    } else {
      console.error('Using auth token from AUTH_TOKEN environment variable');
    }

    httpServer = await runHttpServer(slackClient, port, finalAuthToken, agentConfig, userToken);
  }
}

if (import.meta.url.startsWith('file://')) {
  const currentFile = fileURLToPath(import.meta.url);
  const executedFile = process.argv[1] ? resolve(process.argv[1]) : '';

  const isTestEnvironment = process.argv.some(arg => arg.includes('vitest') || arg.includes('jest')) ||
                            process.env.NODE_ENV === 'test';

  const isMainModule = !isTestEnvironment && (
    currentFile === executedFile ||
    (process.argv[1] && process.argv[1].includes('slack-mcp'))
  );

  if (isMainModule) {
    main().catch((error) => {
      console.error("Fatal error in main():", error);
      process.exit(1);
    });
  }
}
