import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuthLockoutCache } from "../src/auth";
import { handleRequest } from "../src/http";
import { createInvestbrainServer } from "../src/server";
import { BASE_URL, mockFetch, testEnv, TOKEN } from "./helpers";

afterEach(() => {
	clearAuthLockoutCache();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function readMcpBody(response: Response): Promise<unknown> {
	const text = await response.text();
	const data = text
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter((line) => line.length > 0)
		.at(-1);
	return JSON.parse(data ?? text) as unknown;
}

describe("MCP protocol", () => {
	it("lists the tools and calls investbrain_get_me with the request bearer token", async () => {
		const mocked = mockFetch(() => Response.json({ id: 1, name: "Ada" }));
		vi.stubGlobal("fetch", mocked.fetch);
		const env = testEnv();
		const handler = createMcpHandler(
			(ctx) => {
				if (ctx.requestInfo === undefined) throw new Error("missing request");
				return createInvestbrainServer(ctx.requestInfo, env);
			},
		);

		const request = new Request("https://investbrain-mcp.example.workers.dev/mcp", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
			},
		});

		const listed = await handler.fetch(
			new Request(request, {
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
					params: {},
				}),
			}),
		);
		expect(listed.status).toBe(200);
		const listedBody = (await readMcpBody(listed)) as {
			result?: { tools?: { name: string; annotations?: { destructiveHint?: boolean } }[] };
		};
		const tools = listedBody.result?.tools ?? [];
		expect(tools.map((tool) => tool.name)).toContain("investbrain_get_me");
		expect(tools).toHaveLength(15);
		expect(tools.find((tool) => tool.name === "investbrain_delete_portfolio")?.annotations?.destructiveHint).toBe(
			true,
		);

		const called = await handler.fetch(
			new Request(request, {
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "investbrain_get_me", arguments: {} },
				}),
			}),
		);
		expect(called.status).toBe(200);
		const calledBody = (await readMcpBody(called)) as { result?: { content?: { text: string }[] } };
		expect(calledBody.result?.content?.[0]?.text).toBe('{"id":1,"name":"Ada"}');
		expect(mocked.calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
		expect(mocked.calls[0]?.url).toBe(`${BASE_URL}/api/me`);
		expect(JSON.stringify(calledBody)).not.toContain(TOKEN);
	});

	it("lists every tool with a top-level object inputSchema", async () => {
		const mocked = mockFetch(() => Response.json({ id: 1 }));
		vi.stubGlobal("fetch", mocked.fetch);
		const env = testEnv();
		const handler = createMcpHandler((ctx) => {
			if (ctx.requestInfo === undefined) throw new Error("missing request");
			return createInvestbrainServer(ctx.requestInfo, env);
		});
		const listed = await handler.fetch(
			new Request("https://investbrain-mcp.example.workers.dev/mcp", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					Accept: "application/json, text/event-stream",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			}),
		);
		const listedBody = (await readMcpBody(listed)) as {
			result?: { tools?: { name: string; inputSchema?: Record<string, unknown> }[] };
		};
		const tools = listedBody.result?.tools ?? [];
		expect(tools).toHaveLength(15);
		for (const tool of tools) {
			expect(tool.inputSchema?.type, tool.name).toBe("object");
			expect(tool.inputSchema?.oneOf, tool.name).toBeUndefined();
			expect(tool.inputSchema?.anyOf, tool.name).toBeUndefined();
		}
		const created = tools.find((tool) => tool.name === "investbrain_create_transaction");
		const properties = created?.inputSchema?.properties as
			| { transaction_type?: { enum?: string[] } }
			| undefined;
		expect(properties?.transaction_type?.enum).toEqual(["BUY", "SELL"]);
	});

	it("returns an upstream 401 from a tool call when the probe was cached", async () => {
		let meCalls = 0;
		const mocked = mockFetch((call) => {
			if (!call.url.endsWith("/api/me")) return new Response("no", { status: 500 });
			meCalls += 1;
			if (meCalls <= 2) return Response.json({ id: 1, name: "Ada" });
			return new Response(JSON.stringify({ message: `Unauthenticated ${TOKEN}` }), { status: 401 });
		});
		vi.stubGlobal("fetch", mocked.fetch);
		const env = testEnv();
		const handler = createMcpHandler((ctx) => {
			if (ctx.requestInfo === undefined) throw new Error("missing request");
			return createInvestbrainServer(ctx.requestInfo, env);
		});
		const callTool = () =>
			handleRequest(
				new Request("https://investbrain-mcp.example.workers.dev/mcp", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${TOKEN}`,
						"CF-Connecting-IP": "203.0.113.50",
						Accept: "application/json, text/event-stream",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 2,
						method: "tools/call",
						params: { name: "investbrain_get_me", arguments: {} },
					}),
				}),
				env,
				undefined,
				(request) => handler.fetch(request),
			);

		const first = await callTool();
		expect(first.status).toBe(200);
		expect(mocked.calls).toHaveLength(2);

		const second = await callTool();
		expect(second.status).toBe(200);
		expect(mocked.calls).toHaveLength(3);
		const body = (await readMcpBody(second)) as {
			result?: { isError?: boolean; content?: { text: string }[] };
		};
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content?.[0]?.text).toContain("401");
		expect(JSON.stringify(body)).not.toContain(TOKEN);
	});
});
