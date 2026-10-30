import { bearerToken } from "./bearer";
import { clientAddress } from "./client-address";
import { InvestbrainApiError, InvestbrainClient, InvestbrainConfigError, resolveBaseUrl } from "./investbrain";
import {
	authFailurePolicy,
	type AuthFailurePolicy,
	type AuthGate,
	type RateLimitConfig,
} from "./rate-limit-policy";

const UNAUTHORIZED_HEADERS = {
	"content-type": "text/plain; charset=utf-8",
	"WWW-Authenticate": "Bearer",
	"cache-control": "no-store",
};

/**
 * Lockouts this isolate has already confirmed. A hit fails closed with no
 * Durable Object call. A miss is not treated as allowed. Never stores tokens.
 */
const lockoutUntilMs = new Map<string, number>();
const MAX_CACHED_LOCKOUTS = 1024;

export type AuthLimiter = {
	check(): Promise<AuthGate> | AuthGate;
	recordFailure(policy: AuthFailurePolicy): Promise<AuthGate> | AuthGate;
};

export type AuthEnv = RateLimitConfig & {
	INVESTBRAIN_BASE_URL?: string;
	AUTH_RATE_LIMIT: {
		getByName(name: string): AuthLimiter;
	};
};

export function clearAuthLockoutCache(): void {
	lockoutUntilMs.clear();
}

/** Test hook: cache keys are client IPs, never bearer tokens. */
export function authLockoutCacheKeys(): string[] {
	return [...lockoutUntilMs.keys()];
}

/**
 * Returns a response when the request must be refused, or null when it may proceed.
 * OPTIONS is the CORS preflight. Browsers cannot attach Authorization to it.
 */
export async function authorizeMcpRequest(
	request: Request,
	env: AuthEnv,
	deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<Response | null> {
	if (request.method === "OPTIONS") return null;

	let baseUrl: string;
	try {
		baseUrl = resolveBaseUrl(env.INVESTBRAIN_BASE_URL);
	} catch (error) {
		const message =
			error instanceof InvestbrainConfigError
				? error.message
				: "INVESTBRAIN_BASE_URL is not configured.";
		console.error(JSON.stringify({ message, path: new URL(request.url).pathname }));
		return new Response(message, {
			status: 503,
			headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
		});
	}

	const ip = clientAddress(request);
	const cachedRetryAfter = cachedLockout(ip, deps.now ?? Date.now);
	if (cachedRetryAfter !== null) return lockedOut(cachedRetryAfter);

	const limiter = env.AUTH_RATE_LIMIT.getByName(`ip:${ip}`);
	const policy = authFailurePolicy(env);

	try {
		const gate = await limiter.check();
		if (gate.locked) {
			rememberLockout(ip, gate.retryAfter, deps.now ?? Date.now);
			return lockedOut(gate.retryAfter);
		}
	} catch (error) {
		return limiterUnavailable(error);
	}

	const token = bearerToken(request.headers.get("Authorization"));
	if (token === null) return reject(limiter, policy, ip, deps.now ?? Date.now);

	const client = new InvestbrainClient(baseUrl, token, deps.fetchImpl ?? fetch);
	try {
		await client.getMe();
	} catch (error) {
		if (error instanceof InvestbrainApiError && error.status === 401) {
			return reject(limiter, policy, ip, deps.now ?? Date.now);
		}
		console.error(
			JSON.stringify({
				message: "Investbrain token probe failed",
				status: error instanceof InvestbrainApiError ? error.status : 0,
			}),
		);
		return new Response("Investbrain is unavailable.", {
			status: 502,
			headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
		});
	}

	return null;
}

async function reject(
	limiter: AuthLimiter,
	policy: AuthFailurePolicy,
	ip: string,
	now: () => number,
): Promise<Response> {
	try {
		const gate = await limiter.recordFailure(policy);
		if (gate.locked) {
			rememberLockout(ip, gate.retryAfter, now);
			if (gate.justLocked) {
				console.error(
					JSON.stringify({
						message: "MCP auth lockout started",
						ip,
						retryAfter: gate.retryAfter,
					}),
				);
			}
			return lockedOut(gate.retryAfter);
		}
	} catch (error) {
		return limiterUnavailable(error);
	}

	return new Response("Unauthorized", { status: 401, headers: UNAUTHORIZED_HEADERS });
}

function limiterUnavailable(error: unknown): Response {
	console.error(
		JSON.stringify({
			message: "MCP auth limiter failed; refusing request",
			error: error instanceof Error ? error.message : "unknown",
		}),
	);
	return new Response("Authentication protection is unavailable.", {
		status: 503,
		headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
	});
}

function cachedLockout(ip: string, now: () => number): number | null {
	const until = lockoutUntilMs.get(ip);
	if (until === undefined) return null;
	const remainingMs = until - now();
	if (remainingMs <= 0) {
		lockoutUntilMs.delete(ip);
		return null;
	}
	return Math.max(1, Math.ceil(remainingMs / 1000));
}

function rememberLockout(ip: string, retryAfterSeconds: number, now: () => number): void {
	if (lockoutUntilMs.size >= MAX_CACHED_LOCKOUTS && !lockoutUntilMs.has(ip)) {
		const oldest = lockoutUntilMs.keys().next().value;
		if (oldest !== undefined) lockoutUntilMs.delete(oldest);
	}
	lockoutUntilMs.set(ip, now() + retryAfterSeconds * 1000);
}

function lockedOut(retryAfter: number): Response {
	return new Response("Too many failed authentication attempts. Try again later.", {
		status: 429,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"retry-after": String(retryAfter),
			"cache-control": "no-store",
		},
	});
}
