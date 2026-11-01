import { describe, expect, it } from "vitest";
import { InvestbrainApiError, InvestbrainClient, resolveBaseUrl } from "../src/investbrain";
import { BASE_URL, mockFetch, TOKEN } from "./helpers";

describe("resolveBaseUrl", () => {
	it("strips a trailing slash and keeps a subpath", () => {
		expect(resolveBaseUrl("https://investbrain.example.com/")).toBe(BASE_URL);
		expect(resolveBaseUrl("https://investbrain.example.com/app/")).toBe(`${BASE_URL}/app`);
	});

	it("rejects credentials and queries", () => {
		expect(() => resolveBaseUrl("https://user:secret@investbrain.example.com")).toThrow(/credentials/);
		expect(() => resolveBaseUrl("https://investbrain.example.com?token=secret")).toThrow(/query/);
		expect(() => resolveBaseUrl("")).toThrow(/unset/);
	});
});

describe("InvestbrainClient", () => {
	it("redacts the token from an error body and does not follow redirects", async () => {
		const redirected = mockFetch(() => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }));
		const client = new InvestbrainClient(BASE_URL, TOKEN, redirected.fetch);
		await expect(client.getMe()).rejects.toBeInstanceOf(InvestbrainApiError);
		expect(redirected.calls).toHaveLength(1);

		const leaked = mockFetch(
			() => new Response(JSON.stringify({ message: `nope ${TOKEN}` }), { status: 422 }),
		);
		const failing = new InvestbrainClient(BASE_URL, TOKEN, leaked.fetch);
		await expect(failing.getMe()).rejects.toThrow(/422/);
		try {
			await failing.getMe();
		} catch (error) {
			expect(error).toBeInstanceOf(InvestbrainApiError);
			expect((error as Error).message).not.toContain(TOKEN);
			expect((error as Error).message).toContain("[redacted]");
		}
	});

	it("surfaces a dividend 422 message and field errors", async () => {
		const mocked = mockFetch(
			() =>
				new Response(
					JSON.stringify({
						message: "A dividend for this symbol and date already exists.",
						errors: { date: ["A dividend for this symbol and date already exists."] },
					}),
					{ status: 422 },
				),
		);
		const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
		await expect(
			client.createDividend({ symbol: "PETR4.SA", date: "2024-08-15", dividend_amount: 0.85 }),
		).rejects.toThrow(
			"Investbrain API returned 422: A dividend for this symbol and date already exists.; date: A dividend for this symbol and date already exists.",
		);
	});
});
