# @forumulate/mcp

Connect Claude Desktop, Claude Code, Cursor or VS Code to [Forumulate](https://forumulate.com) in one line.

```sh
npx -y @forumulate/mcp
```

This is a small stdio [Model Context Protocol](https://modelcontextprotocol.io) server. It holds no tools of its own: it forwards `tools/list`, `tools/call` and the resource requests to Forumulate's hosted MCP server over HTTPS. The tool set is defined server-side, so a tool Forumulate adds appears in your client without updating this package.

## 1. Get a token

Mint a Personal Access Token at **Account → Tokens** ([forumulate.com/account/tokens](https://forumulate.com/account/tokens)). Give it `read` for an assistant that only reads, or `read` + `write` for one that drafts and publishes. [API tokens and scopes](https://forumulate.com/guides/api-tokens-and-scopes) explains the two gates a token passes.

## 2. Add it to your client

Replace `ak_…` with your token.

### Claude Code

```sh
claude mcp add forumulate -e FORUMULATE_TOKEN=ak_… -- npx -y @forumulate/mcp
```

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "forumulate": {
      "command": "npx",
      "args": ["-y", "@forumulate/mcp"],
      "env": { "FORUMULATE_TOKEN": "ak_…" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "forumulate": {
      "command": "npx",
      "args": ["-y", "@forumulate/mcp"],
      "env": { "FORUMULATE_TOKEN": "ak_…" }
    }
  }
}
```

### VS Code

`.vscode/mcp.json`. The `inputs` block makes VS Code ask for the token once and store it, so it is not committed with the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "forumulate-token",
      "description": "Forumulate token",
      "password": true
    }
  ],
  "servers": {
    "forumulate": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@forumulate/mcp"],
      "env": { "FORUMULATE_TOKEN": "${input:forumulate-token}" }
    }
  }
}
```

## Environment

| Variable             | Default                  | What it does                                                                                                                                    |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORUMULATE_TOKEN`   | none                     | Your Personal Access Token. Required for the `write` server.                                                                                    |
| `FORUMULATE_URL`     | `https://forumulate.com` | The Forumulate site. The API is its `/api`.                                                                                                     |
| `FORUMULATE_MCP`     | `write`                  | Which hosted server: `write` or `read` (below).                                                                                                 |
| `FORUMULATE_ORG`     | your only org            | Organization id or slug. Only needed when your token reaches more than one organization. The error message lists the slugs you can choose from. |
| `FORUMULATE_SPACE`   | none                     | `read` only: the id of the public docs space to serve.                                                                                          |
| `FORUMULATE_MCP_URL` | none                     | An exact hosted MCP endpoint. Overrides everything above except the token.                                                                      |
| `FORUMULATE_API_URL` | none                     | The API base, for a local API that has no `/api` prefix (`http://localhost:4000`).                                                              |

The SDK and the CLI read the same `FORUMULATE_TOKEN` and `FORUMULATE_URL`, so one environment configures all three.

## Read vs write: the two hosted servers

|               | `FORUMULATE_MCP=write` (default)                                                                                                                                          | `FORUMULATE_MCP=read`                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Endpoint      | `/api/orgs/{org}/mcp`                                                                                                                                                     | `/api/public/orgs/{org}/spaces/{space}/mcp`                                 |
| Who it is for | An agent working **in** your organization                                                                                                                                 | Anyone reading **one published docs space**                                 |
| Auth          | Your token. It acts as you.                                                                                                                                               | None. Anonymous and public by design.                                       |
| Reach         | Every space you can reach: docs, forum, blog, roadmap, status                                                                                                             | Published, public pages in one space, plus the public community around them |
| Tools         | `list_spaces`, `get_space_shape`, `search`, `list_items`, `get_item`, `create_item`, `update_section`, `publish_item`, moderation and roadmap tools, `call_api`, and more | `search_docs`, `list_pages`, `get_page`, `search_community`, `get_topic`    |
| Resources     | `forumulate://openapi`, `forumulate://space-types`                                                                                                                        | none                                                                        |
| Can it write? | Yes, when the token has the `write` scope and you have the capability in that space. A `read`-scoped token can call the read tools; the write tools refuse it.            | Never. A write tool on a public, anonymous endpoint would be a write hole.  |

Use `read` to give an assistant your product's documentation, for example in a support bot or a coding agent working against your API. Configure it with ids, which are in the reader URL `/p/{orgId}/{spaceId}`:

```sh
claude mcp add acme-docs -e FORUMULATE_MCP=read -e FORUMULATE_ORG=<orgId> -e FORUMULATE_SPACE=<spaceId> -- npx -y @forumulate/mcp
```

A published site also advertises its endpoint at `/.well-known/mcp/server-card.json`. You can paste that `url` into `FORUMULATE_MCP_URL` instead.

## Native remote config (no npx)

Both hosted servers speak MCP's streamable HTTP transport (JSON response mode), so a client that supports remote servers with headers can connect directly, without this package:

```sh
# Claude Code
claude mcp add --transport http forumulate https://forumulate.com/api/orgs/<org>/mcp \
  --header "Authorization: Bearer ak_…"
```

```jsonc
// Cursor (~/.cursor/mcp.json)
{
  "mcpServers": {
    "forumulate": {
      "url": "https://forumulate.com/api/orgs/<org>/mcp",
      "headers": { "Authorization": "Bearer ak_…" },
    },
  },
}
```

```jsonc
// VS Code (.vscode/mcp.json)
{
  "servers": {
    "forumulate": {
      "type": "http",
      "url": "https://forumulate.com/api/orgs/<org>/mcp",
      "headers": { "Authorization": "Bearer ak_…" },
    },
  },
}
```

The public `read` server needs no header: `https://forumulate.com/api/public/orgs/<orgId>/spaces/<spaceId>/mcp`.

Claude Desktop's remote connectors expect OAuth rather than a static header, so use the stdio config above there. The bridge also works out your organization for you, which the native config cannot.

## Troubleshooting

The bridge writes its log to stderr. Claude Desktop, Cursor and VS Code show it in their MCP server logs, and `claude mcp list` shows the connection state. Errors explain what to change:

- `Forumulate rejected the request (401 …)`: `FORUMULATE_TOKEN` is missing, expired or revoked.
- `This token reaches N organizations; set FORUMULATE_ORG to one of: …`: choose one and add it to `env`.
- `Forumulate refused the request (403 …)`: the token lacks a scope or capability for that action. See [API tokens and scopes](https://forumulate.com/guides/api-tokens-and-scopes).

Run `npx -y @forumulate/mcp --version` to check the installed version.

## Related

- [`@forumulate/sdk`](https://www.npmjs.com/package/@forumulate/sdk): a typed TypeScript client for the REST API.
- [`@forumulate/cli`](https://www.npmjs.com/package/@forumulate/cli): the `forumulate` command, for scripts and CI.
- [API reference](https://forumulate.com/reference) · [Guides](https://forumulate.com/guides) · [Community](https://forumulate.com/community)

## License

MIT

---

## About this repository

This repository is a public mirror, refreshed on each Forumulate release
(one commit per release). Pull requests are welcome; accepted changes are
applied upstream and arrive here with the next release.

- API reference: https://forumulate.com/reference
- Guides: https://forumulate.com/guides
- Community and support: https://forumulate.com/community
- Source: https://github.com/forumulate/mcp
