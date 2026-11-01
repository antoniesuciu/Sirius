/**
 * The MCP tool surface (ADR-6). Tools come straight from the op registry and every call
 * goes to the core, so this adapter holds no logic and cannot widen what agents may do.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  isAgentTool,
  isProposable,
  type OpDefinition,
  type OpInput,
  type OpName,
  opNames,
  ops,
  type SiriusClient,
} from '@sirius/contracts';

/** An agent cannot propose an operation it has never heard of, so the tool lists them. */
function proposeDescription(): string {
  const lines = opNames.filter(isProposable).map((name) => {
    const def = ops[name] as OpDefinition;
    return `- ${name}(${Object.keys(def.input.shape).join(', ')}): ${def.summary}`;
  });
  return `${ops.propose_changes.summary}\n\nEach entry in ops is { op, input }. Available ops:\n${lines.join('\n')}`;
}

function describe(name: OpName): string {
  return name === 'propose_changes' ? proposeDescription() : ops[name].summary;
}

export function createMcpServer(client: SiriusClient): McpServer {
  const server = new McpServer({ name: 'sirius', version: '0.1.0' });
  for (const name of opNames.filter(isAgentTool)) {
    const def = ops[name] as OpDefinition;
    server.registerTool(
      name,
      {
        description: describe(name),
        inputSchema: def.input,
        annotations: { readOnlyHint: def.class === 'read' },
      },
      async (input: unknown) => {
        try {
          const output = await client.call(name, input as OpInput<typeof name>);
          return { content: [{ type: 'text', text: JSON.stringify(output) }] };
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text', text }], isError: true };
        }
      },
    );
  }
  return server;
}
