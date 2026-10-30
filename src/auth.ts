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

/**
 * Successful GET /api/me checks for this isolate. The key is a SHA-256 hex
 * digest of the bearer token, never the token. A hit skips the probe only.
 * Tool calls still go to Investbrain. Not shared across isolates, and not
 * written to Durable Object storage.
 */
const validationUntilMs = new Map<string, number>();
export const AUTH_VALIDATION_TTL_MS = 60_000;
export const MAX_CACHED_VALIDATIONS = 256;

export type AuthLimiter = {
	check(): Promise<AuthGate> | AuthGate;
	recordFailure(policy: AuthFailurePolicy): Promise<AuthGate> | AuthGate;
};

export type AuthEnv = RateLimitConfig & {
	INVESTBRAIN_BASE_URL?: string;
	ALLOWED_HOSTNAMES?: string;
	AUTH_RATE_LIMIT: {
		getByName(name: string): AuthLimiter;
	};
};

/** Test hook: drop in-isolate lockout and token-validation caches. */
export function clearAuthLockoutCache(): void {
	lockoutUntilMs.clear();
	validationUntilMs.clear();
}

/** Test hook: cache keys are client IPs, never bearer tokens. */
export function authLockoutCacheKeys(): string[] {
	return [...lockoutUntilMs.keys()];
}

/** Test hook: validation keys are SHA-256 hex digests, never bearer tokens. */
export function authValidationCacheKeys(): string[] {
	return [...validationUntilMs.keys()];
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

	const clock = deps.now ?? Date.now;
	const token = bearerToken(request.headers.get("Authorization"));
	if (token === null) return reject(limiter, policy, ip, clock);

	const validationKey = await tokenDigest(token);
	if (validationFresh(validationKey, clock())) return null;

	// Leave fetchImpl unset so the client uses its free-function default.
	// Passing the global fetch and calling it as a method throws on Workers.
	const client = new InvestbrainClient(baseUrl, token, deps.fetchImpl);
	try {
		await client.getMe();
	} catch (error) {
		if (error instanceof InvestbrainApiError && error.status === 401) {
			return reject(limiter, policy, ip, clock);
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

	rememberValidation(validationKey, clock());
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

async function tokenDigest(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	let hex = "";
	for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
	return hex;
}

function validationFresh(key: string, now: number): boolean {
	const until = validationUntilMs.get(key);
	if (until === undefined) return false;
	if (until <= now) {
		validationUntilMs.delete(key);
		return false;
	}
	return true;
}

function rememberValidation(key: string, now: number): void {
	for (const [cached, until] of validationUntilMs) {
		if (until <= now) validationUntilMs.delete(cached);
	}
	if (validationUntilMs.size >= MAX_CACHED_VALIDATIONS && !validationUntilMs.has(key)) {
		const oldest = validationUntilMs.keys().next().value;
		if (oldest !== undefined) validationUntilMs.delete(oldest);
	}
	validationUntilMs.set(key, now + AUTH_VALIDATION_TTL_MS);
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
