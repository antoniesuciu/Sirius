/**
 * `sirius-mcp`: stdio MCP server. Usage: `sirius-mcp --agent claude|codex`.
 * SIRIUS_VIA=chat marks calls made during a Sirius chat turn; otherwise they are `mcp`.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentId, createHttpClient } from '@sirius/contracts';
import { createMcpServer } from './server.ts';

const { values } = parseArgs({ options: { agent: { type: 'string', default: 'claude' } } });

const dataDir = process.env.SIRIUS_DATA_DIR ?? join(homedir(), '.local/share/sirius');
const tokenFile = process.env.SIRIUS_TOKEN_FILE ?? join(dataDir, 'token');

const client = createHttpClient({
  baseUrl: process.env.SIRIUS_CORE_URL ?? `http://127.0.0.1:${process.env.SIRIUS_PORT ?? 7337}`,
  token: readFileSync(tokenFile, 'utf8').trim(),
  actor: AgentId.parse(values.agent),
  via: process.env.SIRIUS_VIA === 'chat' ? 'chat' : 'mcp',
});

await createMcpServer(client).connect(new StdioServerTransport());
