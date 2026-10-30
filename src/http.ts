import { authorizeMcpRequest, type AuthEnv } from "./auth";
import { SERVER_NAME, SERVER_VERSION } from "./constants";

export const MCP_PATH = "/mcp";

export type McpFetch = (
	request: Request,
	env: AuthEnv,
	ctx: ExecutionContext,
) => Promise<Response>;

const SERVICE_INFO = {
	status: "ok",
	service: "investbrain-mcp",
	version: SERVER_VERSION,
	endpoints: {
		"/health": "Health check",
		[MCP_PATH]: "Streamable HTTP MCP endpoint",
	},
};

export async function handleRequest<Ctx>(
	request: Request,
	env: AuthEnv,
	ctx: Ctx,
	mcp: (request: Request, env: AuthEnv, ctx: Ctx) => Promise<Response>,
): Promise<Response> {
	const url = new URL(request.url);

	if (url.pathname === "/" || url.pathname === "/health") {
		return Response.json(SERVICE_INFO);
	}

	if (url.pathname === MCP_PATH) {
		if (request.method !== "OPTIONS") {
			const denied = await authorizeMcpRequest(request, env);
			if (denied) return denied;
		}
		return mcp(request, env, ctx);
	}

	return new Response(
		`${SERVER_NAME}\n\nEndpoints:\n- /health\n- ${MCP_PATH} (Streamable HTTP MCP)`,
		{ status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
	);
}
