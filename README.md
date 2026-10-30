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
2. In the Cloudflare dashboard, open Workers & Pages and connect the fork with Workers Builds. Production branch: `main`.
3. In the Worker, open Settings → Builds:
   - Deploy command: `pnpm run deploy`
   - Build variable `INVESTBRAIN_BASE_URL`: public origin of your Investbrain app, for example `https://investbrain.example.com`
   - Optional build variable `ALLOWED_HOSTNAMES`: comma-separated hostnames, for example `mcp.example.com`, with no scheme or port
4. A push to `main` deploys. Workers Builds does not copy a build variable into the Worker. `pnpm run deploy` does, with `wrangler deploy --var`. The default command `npx wrangler deploy` would upload the empty placeholder.
5. Leave non-production branch builds off. Their default command does not apply that variable.
6. Wrangler prints the workers.dev host. The MCP endpoint is `https://investbrain-mcp.<account-subdomain>.workers.dev/mcp`.
7. Create an Investbrain API token (below) and put it in the MCP client. Do not add that token as a GitHub secret, a Worker secret, or a build variable.

## Manual deploy

GitHub Actions can deploy the same script. The workflow runs only when you start it. A push does not start it.

1. Create a Cloudflare API token from the "Edit Cloudflare Workers" template, and copy the account ID. Workers Builds does not need this token.
2. In the GitHub fork, add repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `INVESTBRAIN_BASE_URL` | Same origin as the Workers Builds variable |
| `ALLOWED_HOSTNAMES` | Optional. Same comma-separated hostnames. |

3. Actions → Deploy → Run workflow.

## Configuration

| Name | Where it is set | Purpose |
| --- | --- | --- |
| `INVESTBRAIN_BASE_URL` | Workers Builds build variable, or the GitHub Actions secret. Locally, `.dev.vars`. | Origin of Investbrain. `http` or `https`, no userinfo, query, or fragment. A trailing slash is stripped. A path prefix is kept. |
| `ALLOWED_HOSTNAMES` | Optional build variable or GitHub secret. Locally, `.dev.vars`. | Extra Host and Origin names, comma-separated. Empty keeps `workers.dev` and localhost only. |
| `CLOUDFLARE_API_TOKEN` | GitHub secret for the manual workflow only | Wrangler deploy. Workers Builds creates its own token. |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub secret for the manual workflow only | Wrangler deploy |
| `AUTH_FAILURE_LIMIT` | `wrangler.jsonc`, default `10` | Failed auth attempts per client IP before lockout |
| `AUTH_FAILURE_WINDOW_SECONDS` | `wrangler.jsonc`, default `900` | Window those failures are counted in |
| `AUTH_LOCKOUT_SECONDS` | `wrangler.jsonc`, default `1800` | How long the IP stays locked |

The committed `INVESTBRAIN_BASE_URL` and `ALLOWED_HOSTNAMES` values are empty placeholders. `pnpm run deploy` reads those names from the environment and writes them onto the Worker with `wrangler deploy --var`. In Workers Builds, set them as build variables. A value saved only under Settings → Variables and Secrets is replaced on the next deploy. An empty or invalid base URL makes `/mcp` return 503.

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

There is no token argument on the tools. The Worker reads this header, checks it with `GET /api/me`, caches a successful check for 60 seconds, and forwards the same header to Investbrain.

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

The client has to support custom headers. A connector that only offers OAuth cannot send this static bearer token.

`/health` needs no token.

## Security model

1. The Investbrain token is not a Worker secret, not a GitHub secret, and not written to Durable Object storage, logs, or tool arguments.
2. Each request carries `Authorization: Bearer <token>`. The Worker copies that header to Investbrain and drops it when the request ends.
3. Before the MCP handler runs, the Worker calls `GET /api/me` with the same header. A successful check is cached in that isolate for 60 seconds, keyed by the SHA-256 hash of the token, with at most 256 entries. The raw token is not stored. The cache is not shared across isolates and is not written to Durable Object storage. Investbrain `401` on the probe becomes HTTP 401 and is not cached. Other upstream failures become HTTP 502 and are not counted as bad tokens. Tool calls still request Investbrain, so an upstream `401` is a tool error even when the probe was cached. A revoked token can pass the gate until that entry expires.
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

`pnpm dev` serves the Worker on your machine (Wrangler prints the port, usually 8787). Point a client at `http://127.0.0.1:8787/mcp` with the same `Authorization` header. `.dev.vars` overrides the empty placeholders and is gitignored.

From your laptop, `INVESTBRAIN_BASE_URL` can be an Investbrain app that only your machine can reach. A deployed Worker cannot. The deployed URL has to be reachable from Cloudflare.

Regenerate Worker types after a `wrangler.jsonc` change with `pnpm cf-typegen`.

## CI

Pull requests and pushes run `pnpm install --frozen-lockfile`, `pnpm type-check`, and `pnpm test`. That workflow has no secrets and does not deploy. The manual Deploy workflow repeats those checks, then runs `pnpm run deploy`.

## Limitations

1. Transport is stateless Streamable HTTP at `/mcp`. There is no SSE session. A session would have to keep the API token on the server.
2. A successful `GET /api/me` check is reused for 60 seconds in that isolate. `tools/call` still requests Investbrain.
3. Clients behind one public IP share the auth-failure lockout.
4. Deleting a portfolio follows Investbrain and cascades to that portfolio's holdings and transactions.
5. Market data is whatever that Investbrain instance has configured. Unknown symbols are a 404 from Investbrain, returned as a tool error.
6. This uses the Workers free plan: the Worker script and one SQLite Durable Object. It does not use Workers AI, Queues, or the Rate Limiting binding.
7. The default Host check allows `workers.dev` and localhost. Set `ALLOWED_HOSTNAMES` to add a custom hostname. Those names are also accepted as browser Origin hosts. Requests with no Origin stay valid.

## License

[MIT](LICENSE)
