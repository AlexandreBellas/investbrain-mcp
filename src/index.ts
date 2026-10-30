import { createMcpHandler } from "agents/mcp/server";
import { handleRequest, MCP_PATH, type McpFetch } from "./http";
import { createInvestbrainServer } from "./server";

export { AuthRateLimit } from "./auth-rate-limit";

const callMcp: McpFetch = (request, env, ctx) => {
	const handler = createMcpHandler(
		(mcpContext) => createInvestbrainServer(mcpContext.requestInfo ?? request, env),
		{ route: MCP_PATH },
	);
	return handler(request, env, ctx);
};

export default {
	fetch(request, env, ctx) {
		return handleRequest(request, env, ctx, callMcp);
	},
} satisfies ExportedHandler<Env>;
