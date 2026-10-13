#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createBridgeServer } from './index.js';
import { VERSION } from './version.js';

/*
 * stdout is the MCP channel — anything else written there corrupts the
 * protocol stream — so every human-facing line goes to stderr, which Claude
 * Desktop, Cursor and VS Code all show in their MCP server log.
 */
const log = (line: string) => process.stderr.write(`forumulate-mcp: ${line}\n`);

async function main(): Promise<void> {
  if (process.argv.includes('--version')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const target =
    config.endpoint ??
    `${config.apiBase} (${config.kind} server${config.org ? `, org ${config.org}` : ''})`;
  log(`v${VERSION} bridging stdio to ${target}`);
  if (!config.token && config.kind === 'write' && !config.endpoint) {
    log('FORUMULATE_TOKEN is not set — every request will be refused until it is.');
  }
  const server = createBridgeServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  log(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
