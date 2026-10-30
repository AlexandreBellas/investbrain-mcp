import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuthLockoutCache } from "../src/auth";
import { handleRequest } from "../src/http";
import { mcpRequest, mockFetch, testEnv, TOKEN } from "./helpers";

afterEach(() => {
	clearAuthLockoutCache();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("handleRequest", () => {
	it("serves health without a token", async () => {
		const response = await handleRequest(
			new Request("https://investbrain-mcp.example.workers.dev/health"),
			testEnv(),
			undefined,
			async () => new Response("mcp"),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			service: "investbrain-mcp",
			endpoints: { "/mcp": "Streamable HTTP MCP endpoint" },
		});
	});

	it("returns 401 and does not call the MCP handler when the token is missing", async () => {
		let called = false;
		const response = await handleRequest(mcpRequest({ token: null }), testEnv(), undefined, async () => {
			called = true;
			return new Response("mcp");
		});
		expect(response.status).toBe(401);
		expect(called).toBe(false);
	});

	it("returns 401 when Investbrain rejects the token", async () => {
		const { fetch } = mockFetch(() => new Response("Unauthenticated", { status: 401 }));
		vi.stubGlobal("fetch", fetch);
		let called = false;
		const response = await handleRequest(mcpRequest({ token: TOKEN }), testEnv(), undefined, async () => {
			called = true;
			return new Response("mcp");
		});
		expect(response.status).toBe(401);
		expect(await response.text()).not.toContain(TOKEN);
		expect(called).toBe(false);
	});

	it("forwards the same Authorization header to the MCP handler after a valid probe", async () => {
		const { fetch, calls } = mockFetch(() => Response.json({ id: 1, name: "Ada" }));
		vi.stubGlobal("fetch", fetch);
		let seen: string | null = null;
		const response = await handleRequest(mcpRequest({ token: TOKEN }), testEnv(), undefined, async (request) => {
			seen = request.headers.get("Authorization");
			return new Response("mcp-ok");
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("mcp-ok");
		expect(seen).toBe(`Bearer ${TOKEN}`);
		expect(calls[0]?.url).toBe("https://investbrain.example.com/api/me");
		expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("returns 429 from the rate limiter without calling the MCP handler", async () => {
		const { fetch, calls } = mockFetch(() => new Response("Unauthenticated", { status: 401 }));
		vi.stubGlobal("fetch", fetch);
		const env = testEnv({ AUTH_FAILURE_LIMIT: "1" });
		let called = false;
		const mcp = async () => {
			called = true;
			return new Response("mcp");
		};
		expect((await handleRequest(mcpRequest({ token: TOKEN }), env, undefined, mcp)).status).toBe(429);
		expect((await handleRequest(mcpRequest({ token: TOKEN }), env, undefined, mcp)).status).toBe(429);
		expect(called).toBe(false);
		expect(calls).toHaveLength(1);
	});
});
