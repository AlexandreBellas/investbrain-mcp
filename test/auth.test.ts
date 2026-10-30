import { afterEach, describe, expect, it, vi } from "vitest";
import { authLockoutCacheKeys, authorizeMcpRequest, clearAuthLockoutCache } from "../src/auth";
import { BASE_URL, mcpRequest, mockFetch, testEnv, TOKEN } from "./helpers";

afterEach(() => {
	clearAuthLockoutCache();
	vi.restoreAllMocks();
});

describe("authorizeMcpRequest", () => {
	it("returns 401 when the bearer token is missing and does not call Investbrain", async () => {
		const { fetch, calls } = mockFetch(() => Response.json({ id: 1 }));
		const response = await authorizeMcpRequest(mcpRequest({ token: null }), testEnv(), { fetchImpl: fetch });
		expect(response?.status).toBe(401);
		expect(response?.headers.get("WWW-Authenticate")).toBe("Bearer");
		expect(await response?.text()).toBe("Unauthorized");
		expect(calls).toHaveLength(0);
	});

	it("returns 401 for a rejected Sanctum token and forwards it only on the probe", async () => {
		const { fetch, calls } = mockFetch(
			() => new Response(JSON.stringify({ message: `bad ${TOKEN}` }), { status: 401 }),
		);
		const response = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), testEnv(), { fetchImpl: fetch });
		expect(response?.status).toBe(401);
		expect(await response?.text()).not.toContain(TOKEN);
		expect(calls).toEqual([
			expect.objectContaining({
				url: `${BASE_URL}/api/me`,
				method: "GET",
				authorization: `Bearer ${TOKEN}`,
				redirect: "manual",
			}),
		]);
	});

	it("allows the request when /api/me accepts the token", async () => {
		const { fetch, calls } = mockFetch(() => Response.json({ id: 7, email: "a@example.com" }));
		const response = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), testEnv(), { fetchImpl: fetch });
		expect(response).toBeNull();
		expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
		expect(calls[0]?.url).not.toContain(TOKEN);
	});

	it("returns 502 when Investbrain fails for a reason other than 401", async () => {
		const { fetch } = mockFetch(() => new Response("upstream down", { status: 500 }));
		const response = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), testEnv(), { fetchImpl: fetch });
		expect(response?.status).toBe(502);
		expect(await response?.text()).not.toContain(TOKEN);
	});

	it("locks the client IP after repeated failures and stops calling Investbrain", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { fetch, calls } = mockFetch(() => new Response("Unauthenticated", { status: 401 }));
		const env = testEnv({ AUTH_FAILURE_LIMIT: "2", AUTH_LOCKOUT_SECONDS: "60" });

		const first = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), env, { fetchImpl: fetch });
		const second = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), env, { fetchImpl: fetch });
		const third = await authorizeMcpRequest(mcpRequest({ token: "another-token" }), env, { fetchImpl: fetch });

		expect(first?.status).toBe(401);
		expect(second?.status).toBe(429);
		expect(second?.headers.get("retry-after")).toBe("60");
		expect(third?.status).toBe(429);
		expect(calls).toHaveLength(2);
		expect(authLockoutCacheKeys()).toEqual(["203.0.113.10"]);
		expect(errors.mock.calls.map((args) => args.join(" ")).join("\n")).not.toContain(TOKEN);
	});

	it("returns 503 when the base URL is unset, without counting a failure", async () => {
		const { fetch, calls } = mockFetch(() => Response.json({}));
		const response = await authorizeMcpRequest(mcpRequest({ token: null }), testEnv({ INVESTBRAIN_BASE_URL: "" }), {
			fetchImpl: fetch,
		});
		expect(response?.status).toBe(503);
		expect(calls).toHaveLength(0);
	});

	it("lets CORS preflight through without a token", async () => {
		const { fetch, calls } = mockFetch(() => Response.json({}));
		const response = await authorizeMcpRequest(mcpRequest({ method: "OPTIONS", token: null }), testEnv(), {
			fetchImpl: fetch,
		});
		expect(response).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("returns 503 when the limiter is unavailable", async () => {
		const env = testEnv({
			AUTH_RATE_LIMIT: {
				getByName() {
					return {
						check() {
							throw new Error("do unavailable");
						},
						recordFailure() {
							throw new Error("do unavailable");
						},
					};
				},
			},
		});
		const response = await authorizeMcpRequest(mcpRequest({ token: TOKEN }), env);
		expect(response?.status).toBe(503);
		expect(await response?.text()).toBe("Authentication protection is unavailable.");
	});
});
