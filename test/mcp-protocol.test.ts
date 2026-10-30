import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { createInvestbrainServer } from "../src/server";
import { BASE_URL, mockFetch, testEnv, TOKEN } from "./helpers";

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
		expect(calledBody.result?.content?.[0]?.text).toContain("Ada");
		expect(mocked.calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
		expect(mocked.calls[0]?.url).toBe(`${BASE_URL}/api/me`);
		expect(JSON.stringify(calledBody)).not.toContain(TOKEN);
		vi.unstubAllGlobals();
	});
});
