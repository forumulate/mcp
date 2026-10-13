import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { BridgeConfig } from './config.js';
import { BridgeError, Upstream } from './upstream.js';
import { VERSION } from './version.js';

export {
  loadConfig,
  apiBaseFrom,
  DEFAULT_SITE,
  type BridgeConfig,
  type ServerKind,
} from './config.js';
export { Upstream, BridgeError } from './upstream.js';
export { VERSION } from './version.js';

const INSTRUCTIONS = {
  write:
    "Forumulate (docs, forum, blog). Tools act as the token's owner: list_spaces, then " +
    'get_space_shape before create_item. A read-only token can call the read tools only. ' +
    'The forumulate://openapi resource plus call_api reach any REST route.',
  read: 'Read-only access to one published Forumulate docs space: search_docs, get_page, search_community, get_topic.',
} as const;

/**
 * The stdio MCP server: the local half of the bridge.
 *
 * It answers `initialize` itself (so a client connects instantly, even before
 * the token is right) and forwards tools and resources to the hosted server.
 * Nothing about a tool is defined here — names, schemas and behaviour all come
 * from Forumulate, so this package never needs a release to gain a tool.
 */
export function createBridgeServer(config: BridgeConfig, upstream = new Upstream(config)): Server {
  const server = new Server(
    { name: config.kind === 'read' ? 'forumulate-docs' : 'forumulate', version: VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS[config.kind] },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    return (await upstream.rpc('tools/list', req.params ?? {})) as ListToolsResult;
  });

  /*
   * A failed CALL comes back as a tool result with `isError`, not a protocol
   * error: the model reads the result and can fix its arguments or tell the
   * user to fix the token, while a JSON-RPC error is often swallowed by the
   * client as "tool failed" with the reason dropped.
   */
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    try {
      return (await upstream.rpc('tools/call', req.params)) as CallToolResult;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text }], isError: true };
    }
  });

  // The public read server has no resources; an empty list is the honest answer.
  server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
    try {
      return (await upstream.rpc('resources/list', req.params ?? {})) as ListResourcesResult;
    } catch (e) {
      if (e instanceof BridgeError && e.code === ErrorCode.MethodNotFound) return { resources: [] };
      throw e;
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return (await upstream.rpc('resources/read', req.params)) as ReadResourceResult;
  });

  return server;
}
