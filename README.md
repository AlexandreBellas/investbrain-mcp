# Investbrain MCP

Remote [Model Context Protocol](https://modelcontextprotocol.io) server for a self-hosted [Investbrain](https://github.com/investbrainapp/investbrain) portfolio tracker. It runs on Cloudflare Workers (free plan) and calls your Investbrain `/api` routes with the Sanctum token your MCP client sends on each request.

The Worker does not store that token.

Keywords: MCP, Model Context Protocol, Investbrain, portfolio tracker, holdings, transactions, market data, Laravel Sanctum, Cloudflare Workers, self-hosted.

## Tools

One tool per Investbrain API route under `auth:sanctum`. Update and delete tools are marked destructive in the MCP tool annotations and in the description.

| Tool | Method | Path |
| --- | --- | --- |
| `investbrain_get_me` | GET | `/api/me` |
| `investbrain_list_portfolios` | GET | `/api/portfolio` |
| `investbrain_get_portfolio` | GET | `/api/portfolio/{portfolio}` |
| `investbrain_create_portfolio` | POST | `/api/portfolio` |
| `investbrain_update_portfolio` | PUT | `/api/portfolio/{portfolio}` |
| `investbrain_delete_portfolio` | DELETE | `/api/portfolio/{portfolio}` |
| `investbrain_list_transactions` | GET | `/api/transaction` |
| `investbrain_get_transaction` | GET | `/api/transaction/{transaction}` |
| `investbrain_create_transaction` | POST | `/api/transaction` |
| `investbrain_update_transaction` | PUT | `/api/transaction/{transaction}` |
| `investbrain_delete_transaction` | DELETE | `/api/transaction/{transaction}` |
| `investbrain_list_holdings` | GET | `/api/holding` |
| `investbrain_get_holding` | GET | `/api/holding/{portfolio}/{symbol}` |
| `investbrain_update_holding` | PUT | `/api/holding/{portfolio}/{symbol}` |
| `investbrain_get_market_data` | GET | `/api/market-data/{symbol}` |

List tools accept Investbrain's filter query: `page`, `itemsPerPage` (default 15, or `-1` for every row), `search`, `sortBy`, and `sortDesc`. Portfolio search matches title and notes. Transaction and holding search match the symbol. `investbrain_list_portfolios` can also filter with `holdings_symbol` (`filter[holdings.symbol]`).

Portfolio and transaction ids are UUIDs. Create and update fields follow Investbrain's form requests: portfolio `title` is 5–255 characters; a transaction is `BUY` (requires `cost_basis`) or `SELL` (requires `sale_price`); quantity must be greater than 0; a sell cannot exceed shares owned before that date; holding update only sets `reinvest_dividends`.

Laravel registers PUT and PATCH for each update action. These tools send PUT.

## Quick start

1. Fork this repository.
2. In the Cloudflare dashboard, create an API token that can edit Workers scripts on the free plan, and copy the account ID.
3. In the GitHub fork, add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `INVESTBRAIN_BASE_URL` | Public origin of your Investbrain app, for example `https://investbrain.example.com` |

4. Actions → Deploy → Run workflow. The same workflow also runs on every push to `main`.
5. Wrangler prints the workers.dev host. The MCP endpoint is `https://investbrain-mcp.<account-subdomain>.workers.dev/mcp`.
6. Create an Investbrain API token (below) and put it in the MCP client. Do not add that token as a GitHub or Worker secret.

## Configuration

| Name | Where it is set | Purpose |
| --- | --- | --- |
| `INVESTBRAIN_BASE_URL` | GitHub secret `INVESTBRAIN_BASE_URL`, written into the Worker at deploy. Locally, `.dev.vars`. | Origin of Investbrain. `http` or `https`, no userinfo, query, or fragment. A trailing slash is stripped. A path prefix is kept. |
| `CLOUDFLARE_API_TOKEN` | GitHub secret, workflow env only | Wrangler deploy |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub secret, workflow env only | Wrangler deploy |
| `AUTH_FAILURE_LIMIT` | `wrangler.jsonc`, default `10` | Failed auth attempts per client IP before lockout |
| `AUTH_FAILURE_WINDOW_SECONDS` | `wrangler.jsonc`, default `900` | Window those failures are counted in |
| `AUTH_LOCKOUT_SECONDS` | `wrangler.jsonc`, default `1800` | How long the IP stays locked |

The committed `INVESTBRAIN_BASE_URL` value is an empty placeholder. Deploy replaces that placeholder from the GitHub secret. An empty or invalid URL makes `/mcp` return 503.

## Create an API token

1. Sign in to your Investbrain instance.
2. Open `/user/api-tokens`.
3. Create a token and name it, for example `MCP`.
4. Copy the plaintext token. Investbrain shows it once.

The API routes use Laravel Sanctum (`auth:sanctum`) and do not check token abilities. If the form lists permissions, leave them unset or pick any.

Send that token only from the MCP client:

```http
Authorization: Bearer <investbrain-api-token>
```

There is no token argument on the tools. The Worker reads this header, checks it with `GET /api/me`, then forwards the same header to Investbrain.

## MCP client

Streamable HTTP, endpoint path `/mcp`.

```json
{
  "mcpServers": {
    "investbrain": {
      "type": "http",
      "url": "https://investbrain-mcp.<account-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <investbrain-api-token>"
      }
    }
  }
}
```

The client must send that header on every request to `/mcp`, including tool calls. A missing or rejected token is HTTP 401. Repeated failures from the same IP are HTTP 429.

`/health` needs no token.

## Security model

1. The Investbrain token is not a Worker secret, not a GitHub secret, and not written to Durable Object storage, logs, or tool arguments.
2. Each request carries `Authorization: Bearer <token>`. The Worker copies that header to Investbrain and drops it when the request ends.
3. Before the MCP handler runs, the Worker calls `GET /api/me` with the same header. Investbrain `401` becomes HTTP 401. Other upstream failures become HTTP 502 and are not counted as bad tokens.
4. Missing and rejected tokens are counted per `CF-Connecting-IP` (Cloudflare overwrites a client-supplied value). The default is 10 failures in 15 minutes, then a 30 minute lockout. The counter is a SQLite Durable Object, which the Workers free plan includes. The in-memory cache stores the IP and the lockout expiry, not the token.
5. Redirects are not followed, so the token is not sent to another host.
6. `INVESTBRAIN_BASE_URL` is the address of your Investbrain app. It is not an API key.

## Local development

Requires Node.js 22 or newer and pnpm 10.

```sh
pnpm install
cp .dev.vars.example .dev.vars
# edit INVESTBRAIN_BASE_URL
pnpm dev
pnpm test
pnpm type-check
```

`pnpm dev` serves the Worker on your machine (Wrangler prints the port, usually 8787). Point a client at `http://127.0.0.1:8787/mcp` with the same `Authorization` header. `.dev.vars` overrides the empty placeholder and is gitignored.

From your laptop, `INVESTBRAIN_BASE_URL` can be an Investbrain app that only your machine can reach. A deployed Worker cannot. The deployed URL has to be reachable from Cloudflare.

Regenerate Worker types after a `wrangler.jsonc` change with `pnpm cf-typegen`.

## Limitations

1. Transport is stateless Streamable HTTP at `/mcp`. There is no SSE session. A session would have to keep the API token on the server.
2. Every MCP request, including `tools/list` and `tools/call`, is checked with `GET /api/me` first.
3. Clients behind one public IP share the auth-failure lockout.
4. Deleting a portfolio follows Investbrain and cascades to that portfolio's holdings and transactions.
5. Market data is whatever that Investbrain instance has configured. Unknown symbols are a 404 from Investbrain, returned as a tool error.
6. This uses the Workers free plan: the Worker script and one SQLite Durable Object. It does not use Workers AI, Queues, or the Rate Limiting binding.
7. The default Host check allows `workers.dev` and localhost. A custom hostname needs `allowedHostnames` on the handler in `src/index.ts`.

## License

[MIT](LICENSE)
