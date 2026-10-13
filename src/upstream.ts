import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { BridgeConfig } from './config.js';
import { VERSION } from './version.js';

export const TOKENS_PAGE = 'https://forumulate.com/account/tokens';
export const TOKENS_GUIDE = 'https://forumulate.com/guides/api-tokens-and-scopes';

/**
 * Sent on every request. The edge WAF challenges a default library User-Agent
 * with an HTML block page, which would reach the user as "Unexpected token <"
 * — a named client gets the API's JSON instead.
 */
const USER_AGENT = `forumulate-mcp/${VERSION} (+https://www.npmjs.com/package/@forumulate/mcp)`;

/** Something the user can act on, phrased for the person reading the client's log. */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: number = ErrorCode.InternalError,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string } | string;
}

/**
 * Talks JSON-RPC to one hosted Forumulate MCP server over HTTP.
 *
 * The hosted servers are stateless request/response (streamable HTTP in JSON
 * mode, no session id), so there is nothing to hold open: each MCP request the
 * client sends becomes one POST. The tool list is never copied here — it is
 * whatever the hosted server answers today, so a tool added server-side shows up
 * in every client without a new release of this package.
 */
export class Upstream {
  private nextId = 1;
  private endpointPromise?: Promise<string>;

  constructor(
    private readonly config: BridgeConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /** POST one JSON-RPC request and return its `result`, or throw what went wrong. */
  async rpc(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = await this.endpoint();
    const id = this.nextId++;
    const body = await this.post(url, { jsonrpc: '2.0', id, method, params: params ?? {} });
    const msg = pickMessage(body, id);
    if (msg?.error) {
      throw new BridgeError(
        msg.error.message ?? `${method} failed`,
        msg.error.code ?? ErrorCode.InternalError,
      );
    }
    if (!msg || typeof msg.result !== 'object' || msg.result === null) {
      throw new BridgeError(`${url} answered ${method} with no JSON-RPC result.`);
    }
    return msg.result as Record<string, unknown>;
  }

  /**
   * Which hosted server to talk to, worked out once.
   *
   * A failure is not cached: the user fixes the token or the org in the client
   * config, and the next request — not a restart — should notice.
   */
  endpoint(): Promise<string> {
    this.endpointPromise ??= this.resolveEndpoint().catch((e: unknown) => {
      this.endpointPromise = undefined;
      throw e;
    });
    return this.endpointPromise;
  }

  private async resolveEndpoint(): Promise<string> {
    const { endpoint, kind, apiBase, org, space } = this.config;
    if (endpoint) return endpoint;
    if (kind === 'read') {
      if (!org || !space) {
        throw new BridgeError(
          'FORUMULATE_MCP=read serves one public docs space: set FORUMULATE_ORG and ' +
            'FORUMULATE_SPACE to its ids (they are in the reader URL /p/<orgId>/<spaceId>), ' +
            "or set FORUMULATE_MCP_URL to the endpoint in the site's /.well-known/mcp/server-card.json.",
          ErrorCode.InvalidParams,
        );
      }
      return `${apiBase}/public/orgs/${enc(org)}/spaces/${enc(space)}/mcp`;
    }
    return `${apiBase}/orgs/${enc(org ?? (await this.onlyOrg()))}/mcp`;
  }

  /** With no FORUMULATE_ORG, the token's one organization — or a list to choose from. */
  private async onlyOrg(): Promise<string> {
    const res = await this.send(`${this.config.apiBase}/orgs`, { method: 'GET' });
    const { orgs } = (await this.parse(res, 'GET /orgs')) as {
      orgs?: { id: string; slug: string; name: string }[];
    };
    const list = orgs ?? [];
    if (list.length === 1) return list[0]!.id;
    if (list.length === 0) {
      throw new BridgeError(
        'This token belongs to no organization. Create one at https://forumulate.com first.',
      );
    }
    const choices = list.map((o) => `  ${o.slug}  (${o.name})`).join('\n');
    throw new BridgeError(
      `This token reaches ${list.length} organizations; set FORUMULATE_ORG to one of:\n${choices}`,
      ErrorCode.InvalidParams,
    );
  }

  private async post(url: string, payload: unknown): Promise<unknown> {
    const res = await this.send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.parse(res, `POST ${url}`);
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/event-stream',
      'User-Agent': USER_AGENT,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
    try {
      return await this.fetchImpl(url, { ...init, headers });
    } catch (e) {
      const why =
        e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      throw new BridgeError(`Could not reach ${url}: ${why}. Check FORUMULATE_URL.`);
    }
  }

  /** The body as JSON (or SSE `data:` frames), or a BridgeError saying what to fix. */
  private async parse(res: Response, what: string): Promise<unknown> {
    const text = await res.text();
    const type = res.headers.get('content-type') ?? '';
    let body: unknown;
    try {
      body = type.includes('text/event-stream') ? sseMessages(text) : text ? JSON.parse(text) : {};
    } catch {
      body = undefined;
    }
    if (res.ok && body !== undefined) return body;
    throw new BridgeError(
      describeFailure(res.status, what, body as ApiErrorBody | undefined, this.config),
    );
  }
}

function describeFailure(
  status: number,
  what: string,
  body: ApiErrorBody | undefined,
  config: BridgeConfig,
): string {
  const err = body?.error;
  const code = typeof err === 'object' ? err.code : undefined;
  const message = typeof err === 'object' ? err.message : err;
  const said = `${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`;
  if (body === undefined) {
    return `${what} answered ${status} with a non-JSON body (an edge block page or a proxy, not the Forumulate API). Check FORUMULATE_URL.`;
  }
  if (status === 401) {
    const hint = config.token
      ? 'The token was refused: it may be expired, revoked, or for another server.'
      : 'FORUMULATE_TOKEN is not set.';
    return `Forumulate rejected the request (${said}). ${hint} Mint a Personal Access Token at ${TOKENS_PAGE} (${TOKENS_GUIDE}) and set it as FORUMULATE_TOKEN in this MCP server's env.`;
  }
  if (status === 403) {
    return `Forumulate refused the request (${said}). The token lacks a scope or capability this needs — see ${TOKENS_GUIDE}.`;
  }
  if (status === 404) {
    return `Not found (${said}) at ${what}. Check FORUMULATE_ORG${config.kind === 'read' ? ' / FORUMULATE_SPACE (the space must be public)' : ''}.`;
  }
  return `${what} failed (${said}).`;
}

interface RpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** The reply to `id` out of a single message, a batch, or a list of SSE frames. */
function pickMessage(body: unknown, id: number): RpcMessage | undefined {
  const all = (Array.isArray(body) ? body : [body]) as RpcMessage[];
  return all.find((m) => m && m.id === id) ?? (all.length === 1 ? all[0] : undefined);
}

function sseMessages(text: string): unknown[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((frame) =>
      frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data) as unknown);
}

function enc(s: string): string {
  return encodeURIComponent(s);
}
