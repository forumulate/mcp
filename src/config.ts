/**
 * Everything the bridge needs, read from the environment once.
 *
 * MCP clients (Claude Desktop, Cursor, VS Code, Claude Code) launch a stdio
 * server with an `env` block and nothing else — no flags a user would think to
 * add, no config file. So configuration is environment only, and the names are
 * the ones the SDK and the CLI read, so one `.env` drives all three:
 *
 *   FORUMULATE_TOKEN   a Personal Access Token (`ak_…`, `cft_…`)
 *   FORUMULATE_URL     the site, default https://forumulate.com
 *   FORUMULATE_MCP     `write` (default) or `read`: which hosted server
 *   FORUMULATE_ORG     org id or slug (write: optional when you have one org)
 *   FORUMULATE_SPACE   space id (read only: the public docs space to serve)
 *   FORUMULATE_MCP_URL an exact hosted MCP endpoint, overriding all of the above
 *   FORUMULATE_API_URL the API base, for a local API with no `/api` prefix
 */

export const DEFAULT_SITE = 'https://forumulate.com';

export type ServerKind = 'write' | 'read';

export interface BridgeConfig {
  kind: ServerKind;
  /** API base, `/api` included: `https://forumulate.com/api`. */
  apiBase: string;
  token?: string;
  org?: string;
  space?: string;
  /** An exact endpoint, when the user pasted one (e.g. from a server card). */
  endpoint?: string;
}

/** A blank variable is an unset one — `FOO= cmd` is how a shell clears it. */
function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/**
 * The API base from the site URL.
 *
 * `FORUMULATE_URL` names the SITE (what you type in a browser); the API lives at
 * its `/api`. The CLI used to read the same variable as the API base itself, so
 * a value that already ends in `/api` is taken as-is rather than doubled.
 */
export function apiBaseFrom(env: NodeJS.ProcessEnv): string {
  const direct = read(env, 'FORUMULATE_API_URL');
  if (direct) return direct.replace(/\/+$/, '');
  const site = (read(env, 'FORUMULATE_URL') ?? DEFAULT_SITE).replace(/\/+$/, '');
  return /\/api$/i.test(site) ? site : `${site}/api`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const rawKind = (read(env, 'FORUMULATE_MCP') ?? 'write').toLowerCase();
  if (rawKind !== 'write' && rawKind !== 'read') {
    throw new Error(`FORUMULATE_MCP must be "read" or "write" (got "${rawKind}").`);
  }
  return {
    kind: rawKind,
    apiBase: apiBaseFrom(env),
    token: read(env, 'FORUMULATE_TOKEN'),
    org: read(env, 'FORUMULATE_ORG'),
    space: read(env, 'FORUMULATE_SPACE'),
    endpoint: read(env, 'FORUMULATE_MCP_URL'),
  };
}
