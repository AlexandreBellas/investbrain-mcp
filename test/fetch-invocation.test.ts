import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeMcpRequest, clearAuthLockoutCache } from "../src/auth";
import { InvestbrainApiError, InvestbrainClient } from "../src/investbrain";
import { investbrainTools } from "../src/tools";
import { BASE_URL, invocationSensitiveFetch, mcpRequest, testEnv, TOKEN } from "./helpers";

afterEach(() => {
	clearAuthLockoutCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("fetch invocation", () => {
	it("probes a token without calling fetch as a method of the client", async () => {
		const fetchImpl = invocationSensitiveFetch(() => Response.json({ id: 1 }));
		const response = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), testEnv(), { fetchImpl });
		expect(response).toBeNull();
	});

	it("runs a tool call without calling fetch as a method of the client", async () => {
		const fetchImpl = invocationSensitiveFetch(() => Response.json({ id: 1, email: "a@example.com" }));
		const client = new InvestbrainClient(BASE_URL, TOKEN, fetchImpl);
		const tool = investbrainTools.find((item) => item.name === "investbrain_get_me");
		if (tool === undefined) throw new Error("missing investbrain_get_me");
		await expect(tool.call(client, {})).resolves.toEqual({ id: 1, email: "a@example.com" });
	});

	it("uses the default fetch for a probe when none is injected", async () => {
		vi.stubGlobal(
			"fetch",
			invocationSensitiveFetch(() => Response.json({ id: 1 })),
		);
		expect(await authorizeMcpRequest(mcpRequest({ token: TOKEN }), testEnv())).toBeNull();
	});

	it("uses the default fetch for a tool call when none is injected", async () => {
		vi.stubGlobal(
			"fetch",
			invocationSensitiveFetch(() => Response.json({ ok: true })),
		);
		const client = new InvestbrainClient(BASE_URL, TOKEN);
		const tool = investbrainTools.find((item) => item.name === "investbrain_get_me");
		if (tool === undefined) throw new Error("missing investbrain_get_me");
		await expect(tool.call(client, {})).resolves.toEqual({ ok: true });
	});

	it("logs the error name and message without the token or headers", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchImpl = invocationSensitiveFetch(() => {
			throw new TypeError(`connect failed ${TOKEN}`);
		});
		const client = new InvestbrainClient(BASE_URL, TOKEN, fetchImpl);
		await expect(client.getMe()).rejects.toBeInstanceOf(InvestbrainApiError);
		await expect(client.getMe()).rejects.toMatchObject({ status: 0 });

		const logged = errors.mock.calls.map((args) => String(args[0])).join("\n");
		expect(logged).toContain("TypeError");
		expect(logged).toContain("connect failed");
		expect(logged).toContain("[redacted]");
		expect(logged).not.toContain(TOKEN);
		expect(logged.toLowerCase()).not.toContain("authorization");
		expect(logged.toLowerCase()).not.toContain("bearer");
	});
});
