import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpHostAllowlist } from "../src/hostnames";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("mcpHostAllowlist", () => {
	it("leaves the handler defaults in place when the var is empty", () => {
		expect(mcpHostAllowlist("https://mcp.example.com/mcp", undefined)).toBeUndefined();
		expect(mcpHostAllowlist("https://mcp.example.com/mcp", "")).toBeUndefined();
		expect(mcpHostAllowlist("https://mcp.example.com/mcp", "  , ")).toBeUndefined();
	});

	it("adds configured hostnames without trusting the request host", () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const list = mcpHostAllowlist(
			"https://evil.example/mcp",
			" MCP.Example.com, https://nope.example, mcp.example.com ",
		);
		expect(list).toEqual(["localhost", "127.0.0.1", "[::1]", "mcp.example.com"]);
		expect(list).not.toContain("evil.example");
		expect(errors.mock.calls.join(" ")).toContain("Ignoring invalid ALLOWED_HOSTNAMES entry");
		expect(errors.mock.calls.join(" ")).not.toContain("sanctum");
	});

	it("keeps the workers.dev host that received the request", () => {
		const list = mcpHostAllowlist(
			"https://investbrain-mcp.example.workers.dev/mcp",
			"mcp.example.com",
		);
		expect(list).toContain("investbrain-mcp.example.workers.dev");
		expect(list).toContain("mcp.example.com");
		expect(list).toContain("localhost");
	});
});

describe("custom hostname handler", () => {
	it("accepts the configured host and rejects a different Host header", async () => {
		const allow = mcpHostAllowlist("https://mcp.example.com/mcp", "mcp.example.com");
		if (allow === undefined) throw new Error("missing allowlist");
		const handler = createMcpHandler(() => new McpServer({ name: "test", version: "0" }), {
			route: "/mcp",
			allowedHostnames: allow,
			allowedOriginHostnames: allow,
		});
		const headers = {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
		};
		const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

		const denied = await handler.fetch(
			new Request("https://mcp.example.com/mcp", {
				method: "POST",
				headers: { ...headers, host: "evil.example" },
				body,
			}),
		);
		expect(denied.status).toBe(403);

		const allowed = await handler.fetch(
			new Request("https://mcp.example.com/mcp", {
				method: "POST",
				headers: { ...headers, host: "mcp.example.com" },
				body,
			}),
		);
		expect(allowed.status).not.toBe(403);
	});
});
