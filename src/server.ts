import { McpServer } from "@modelcontextprotocol/server";
import { bearerToken } from "./bearer";
import { SERVER_NAME, SERVER_VERSION } from "./constants";
import { InvestbrainClient, resolveBaseUrl } from "./investbrain";
import type { AuthEnv } from "./auth";
import { registerInvestbrainTools } from "./tools";

/**
 * Builds a fresh MCP server for one HTTP request.
 * The Sanctum token is read from that request and is not stored.
 */
export function createInvestbrainServer(request: Request, env: AuthEnv): McpServer {
	const token = bearerToken(request.headers.get("Authorization"));
	if (token === null) {
		throw new Error("Investbrain API token is missing from this request.");
	}
	const client = new InvestbrainClient(resolveBaseUrl(env.INVESTBRAIN_BASE_URL), token);
	const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
	registerInvestbrainTools(server, client);
	return server;
}
