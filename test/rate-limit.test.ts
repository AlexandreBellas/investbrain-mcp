import { describe, expect, it } from "vitest";
import {
	applyFailure,
	authFailurePolicy,
	EMPTY_FAILURE_STATE,
	readLockout,
	type FailureState,
} from "../src/rate-limit-policy";
import { clientAddress } from "../src/client-address";

const policy = { limit: 3, windowMs: 1_000, lockoutMs: 10_000 };

function fail(state: FailureState, now: number) {
	return applyFailure(state, now, policy);
}

describe("auth failure rate limiter", () => {
	it("locks on the limit and does not extend an active lockout", () => {
		let state = { ...EMPTY_FAILURE_STATE, failures: [] as number[] };
		state = fail(state, 1_000).state;
		state = fail(state, 1_100).state;
		const locked = fail(state, 1_200);
		expect(locked.gate).toEqual({ locked: true, retryAfter: 10, justLocked: true });
		expect(locked.state.failures).toEqual([]);
		expect(locked.state.lockoutUntilMs).toBe(11_200);

		const again = fail(locked.state, 2_000);
		expect(again.gate.locked).toBe(true);
		expect(again.gate.justLocked).toBe(false);
		expect(again.state.lockoutUntilMs).toBe(11_200);
		expect(again.state.failures).toEqual([]);
	});

	it("drops failures outside the window", () => {
		let state = fail(EMPTY_FAILURE_STATE, 0).state;
		state = fail(state, 10).state;
		const next = fail(state, 2_000);
		expect(next.gate.locked).toBe(false);
		expect(next.state.failures).toEqual([2_000]);
	});

	it("starts a new window after the lockout expires", () => {
		const locked = fail(fail(fail(EMPTY_FAILURE_STATE, 0).state, 10).state, 20);
		const expired = readLockout(locked.state, locked.state.lockoutUntilMs! + 1);
		expect(expired.gate.locked).toBe(false);
		expect(expired.state).toEqual(EMPTY_FAILURE_STATE);

		const again = applyFailure(expired.state, locked.state.lockoutUntilMs! + 1, policy);
		expect(again.gate.locked).toBe(false);
		expect(again.state.failures).toHaveLength(1);
	});

	it("falls back when the configured limits are not positive integers in range", () => {
		const parsed = authFailurePolicy({
			AUTH_FAILURE_LIMIT: "0",
			AUTH_FAILURE_WINDOW_SECONDS: "nope",
			AUTH_LOCKOUT_SECONDS: "999999999",
		});
		expect(parsed.limit).toBe(10);
		expect(parsed.windowMs).toBe(900_000);
		expect(parsed.lockoutMs).toBe(1_800_000);
	});
});

describe("client address", () => {
	it("uses a valid Cloudflare IP and ignores anything else", () => {
		expect(clientAddress(new Request("https://example.com", { headers: { "CF-Connecting-IP": "203.0.113.8" } }))).toBe(
			"203.0.113.8",
		);
		expect(
			clientAddress(new Request("https://example.com", { headers: { "CF-Connecting-IP": "2001:DB8::1" } })),
		).toBe("2001:db8::1");
		expect(clientAddress(new Request("https://example.com", { headers: { "CF-Connecting-IP": "not-an-ip" } }))).toBe(
			"unknown",
		);
	});
});
