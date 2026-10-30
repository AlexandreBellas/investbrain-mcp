import {
	applyFailure,
	EMPTY_FAILURE_STATE,
	readLockout,
	sanitizePolicy,
	type AuthFailurePolicy,
	type FailureState,
} from "../src/rate-limit-policy";
import type { AuthEnv, AuthLimiter } from "../src/auth";

export const BASE_URL = "https://investbrain.example.com";
export const TOKEN = "sanctum-token-test-value";
export const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111";
export const TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";

export class MemoryAuthLimiter implements AuthLimiter {
	state: FailureState = { failures: [], lockoutUntilMs: EMPTY_FAILURE_STATE.lockoutUntilMs };

	check() {
		const next = readLockout(this.state, Date.now());
		this.state = { failures: [...next.state.failures], lockoutUntilMs: next.state.lockoutUntilMs };
		return next.gate;
	}

	recordFailure(policy: AuthFailurePolicy) {
		const next = applyFailure(this.state, Date.now(), sanitizePolicy(policy));
		this.state = { failures: [...next.state.failures], lockoutUntilMs: next.state.lockoutUntilMs };
		return next.gate;
	}
}

export function testEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
	const limiters = new Map<string, MemoryAuthLimiter>();
	return {
		INVESTBRAIN_BASE_URL: BASE_URL,
		AUTH_FAILURE_LIMIT: "10",
		AUTH_FAILURE_WINDOW_SECONDS: "900",
		AUTH_LOCKOUT_SECONDS: "1800",
		AUTH_RATE_LIMIT: {
			getByName(name: string) {
				let limiter = limiters.get(name);
				if (limiter === undefined) {
					limiter = new MemoryAuthLimiter();
					limiters.set(name, limiter);
				}
				return limiter;
			},
		},
		...overrides,
	};
}

export function mcpRequest(init: { method?: string; token?: string | null; ip?: string } = {}): Request {
	const headers = new Headers();
	headers.set("CF-Connecting-IP", init.ip ?? "203.0.113.10");
	if (init.token !== null && init.token !== undefined) {
		headers.set("Authorization", `Bearer ${init.token}`);
	}
	return new Request("https://investbrain-mcp.example.workers.dev/mcp", {
		method: init.method ?? "POST",
		headers,
	});
}

export type FetchCall = {
	url: string;
	method: string;
	authorization: string | null;
	body: string | null;
	redirect: RequestInit["redirect"];
};

/**
 * Fetch double that throws TypeError "Illegal invocation" when called as a
 * method of an object other than the global. A free call (`this` undefined)
 * and a call on `globalThis` both succeed.
 */
export function invocationSensitiveFetch(
	handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
	const fetchImpl = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		if (this !== globalThis && this !== undefined) {
			throw new TypeError("Illegal invocation");
		}
		return handler(input, init);
	};
	return fetchImpl as typeof fetch;
}

export function mockFetch(handler: (call: FetchCall) => Response): {
	fetch: typeof fetch;
	calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		const headers = new Headers(init?.headers);
		const body = typeof init?.body === "string" ? init.body : null;
		const call: FetchCall = {
			url,
			method: init?.method ?? "GET",
			authorization: headers.get("authorization"),
			body,
			redirect: init?.redirect,
		};
		calls.push(call);
		return handler(call);
	};
	return { fetch: fetchImpl, calls };
}
