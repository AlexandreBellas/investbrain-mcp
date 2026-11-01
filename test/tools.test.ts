import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { InvestbrainClient } from "../src/investbrain";
import { registerInvestbrainTools, investbrainTools } from "../src/tools";
import { BASE_URL, DIVIDEND_ID, mockFetch, PORTFOLIO_ID, TOKEN, TRANSACTION_ID } from "./helpers";

const symbol = "BRK.B";

function clientFor(status: number, body: unknown, callsOut?: ReturnType<typeof mockFetch>) {
	const mocked = callsOut ?? mockFetch(() => Response.json(body, { status }));
	return { client: new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch), calls: mocked.calls };
}

describe("Investbrain MCP tools", () => {
	it("registers one tool per API endpoint and marks updates and deletes as destructive", () => {
		expect(investbrainTools.map((tool) => tool.name)).toEqual([
			"investbrain_get_me",
			"investbrain_list_portfolios",
			"investbrain_get_portfolio",
			"investbrain_create_portfolio",
			"investbrain_update_portfolio",
			"investbrain_delete_portfolio",
			"investbrain_list_transactions",
			"investbrain_get_transaction",
			"investbrain_create_transaction",
			"investbrain_update_transaction",
			"investbrain_delete_transaction",
			"investbrain_list_holdings",
			"investbrain_get_holding",
			"investbrain_update_holding",
			"investbrain_list_dividends",
			"investbrain_get_dividend",
			"investbrain_create_dividend",
			"investbrain_update_dividend",
			"investbrain_delete_dividend",
			"investbrain_get_market_data",
		]);

		const destructive = investbrainTools.filter((tool) => tool.annotations.destructiveHint);
		expect(destructive.map((tool) => tool.name)).toEqual([
			"investbrain_update_portfolio",
			"investbrain_delete_portfolio",
			"investbrain_update_transaction",
			"investbrain_delete_transaction",
			"investbrain_update_holding",
			"investbrain_update_dividend",
			"investbrain_delete_dividend",
		]);
		for (const tool of destructive) {
			expect(tool.description.startsWith("Destructive:")).toBe(true);
			expect(tool.annotations.readOnlyHint).toBe(false);
		}
		for (const tool of investbrainTools) {
			if (!tool.annotations.destructiveHint) expect(tool.description.startsWith("Destructive:")).toBe(false);
		}

		const { client } = clientFor(200, {});
		expect(() => registerInvestbrainTools(new McpServer({ name: "test", version: "0" }), client)).not.toThrow();
	});

	it("calls each endpoint with the bearer token and without putting the token in the URL or body", async () => {
		const cases: { name: string; args: unknown; method: string; path: string; body?: unknown }[] = [
			{ name: "investbrain_get_me", args: {}, method: "GET", path: "/api/me" },
			{
				name: "investbrain_list_portfolios",
				args: { page: 2, itemsPerPage: 5, search: "retire", sortBy: "title", sortDesc: true, holdings_symbol: "AAPL" },
				method: "GET",
				path: "/api/portfolio",
			},
			{ name: "investbrain_get_portfolio", args: { id: PORTFOLIO_ID }, method: "GET", path: `/api/portfolio/${PORTFOLIO_ID}` },
			{
				name: "investbrain_create_portfolio",
				args: { title: "Retirement", notes: null, wishlist: false },
				method: "POST",
				path: "/api/portfolio",
				body: { title: "Retirement", notes: null, wishlist: false },
			},
			{
				name: "investbrain_update_portfolio",
				args: { id: PORTFOLIO_ID, title: "Updated name" },
				method: "PUT",
				path: `/api/portfolio/${PORTFOLIO_ID}`,
				body: { title: "Updated name" },
			},
			{ name: "investbrain_delete_portfolio", args: { id: PORTFOLIO_ID }, method: "DELETE", path: `/api/portfolio/${PORTFOLIO_ID}` },
			{
				name: "investbrain_list_transactions",
				args: { search: "AAPL", itemsPerPage: -1 },
				method: "GET",
				path: "/api/transaction",
			},
			{
				name: "investbrain_get_transaction",
				args: { id: TRANSACTION_ID },
				method: "GET",
				path: `/api/transaction/${TRANSACTION_ID}`,
			},
			{
				name: "investbrain_create_transaction",
				args: {
					portfolio_id: PORTFOLIO_ID,
					symbol: "AAPL",
					transaction_type: "BUY",
					date: "2026-10-01",
					quantity: 2,
					currency: "USD",
					cost_basis: 150,
				},
				method: "POST",
				path: "/api/transaction",
				body: {
					portfolio_id: PORTFOLIO_ID,
					symbol: "AAPL",
					transaction_type: "BUY",
					date: "2026-10-01",
					quantity: 2,
					currency: "USD",
					cost_basis: 150,
				},
			},
			{
				name: "investbrain_update_transaction",
				args: { id: TRANSACTION_ID, sale_price: 20, transaction_type: "SELL" },
				method: "PUT",
				path: `/api/transaction/${TRANSACTION_ID}`,
				body: { sale_price: 20, transaction_type: "SELL" },
			},
			{
				name: "investbrain_delete_transaction",
				args: { id: TRANSACTION_ID },
				method: "DELETE",
				path: `/api/transaction/${TRANSACTION_ID}`,
			},
			{ name: "investbrain_list_holdings", args: { page: 1 }, method: "GET", path: "/api/holding" },
			{
				name: "investbrain_get_holding",
				args: { portfolio: PORTFOLIO_ID, symbol },
				method: "GET",
				path: `/api/holding/${PORTFOLIO_ID}/BRK.B`,
			},
			{
				name: "investbrain_update_holding",
				args: { portfolio: PORTFOLIO_ID, symbol: "AAPL", reinvest_dividends: true },
				method: "PUT",
				path: `/api/holding/${PORTFOLIO_ID}/AAPL`,
				body: { reinvest_dividends: true },
			},
			{
				name: "investbrain_list_dividends",
				args: {
					page: 2,
					itemsPerPage: 25,
					search: "petr",
					sort: "-date, symbol",
					symbol: "PETR4.SA, VALE3.SA",
					source: "manual",
					date: "2024-08-15",
				},
				method: "GET",
				path: "/api/dividend",
			},
			{ name: "investbrain_get_dividend", args: { id: DIVIDEND_ID }, method: "GET", path: `/api/dividend/${DIVIDEND_ID}` },
			{
				name: "investbrain_create_dividend",
				args: { symbol: "PETR4.SA", date: "2024-08-15", dividend_amount: 0.85 },
				method: "POST",
				path: "/api/dividend",
				body: { symbol: "PETR4.SA", date: "2024-08-15", dividend_amount: 0.85 },
			},
			{
				name: "investbrain_update_dividend",
				args: { id: DIVIDEND_ID, dividend_amount: 1.25 },
				method: "PUT",
				path: `/api/dividend/${DIVIDEND_ID}`,
				body: { dividend_amount: 1.25 },
			},
			{
				name: "investbrain_delete_dividend",
				args: { id: DIVIDEND_ID },
				method: "DELETE",
				path: `/api/dividend/${DIVIDEND_ID}`,
			},
			{ name: "investbrain_get_market_data", args: { symbol: "MSFT" }, method: "GET", path: "/api/market-data/MSFT" },
		];

		expect(cases.map((item) => item.name)).toEqual(investbrainTools.map((tool) => tool.name));

		for (const toolCase of cases) {
			const mocked = mockFetch((call) => {
				if (call.method === "DELETE") return new Response(null, { status: 204 });
				return Response.json({ ok: true, path: toolCase.path });
			});
			const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
			const tool = investbrainTools.find((item) => item.name === toolCase.name);
			if (tool === undefined) throw new Error(`missing ${toolCase.name}`);
			const result = await tool.call(client, toolCase.args);
			const call = mocked.calls[0];
			expect(call?.method, toolCase.name).toBe(toolCase.method);
			expect(call?.authorization, toolCase.name).toBe(`Bearer ${TOKEN}`);
			expect(call?.redirect, toolCase.name).toBe("manual");
			const url = new URL(call?.url ?? "");
			expect(url.origin + url.pathname, toolCase.name).toBe(`${BASE_URL}${toolCase.path}`);
			expect(url.toString(), toolCase.name).not.toContain(TOKEN);
			if (toolCase.body !== undefined) expect(JSON.parse(call?.body ?? "")).toEqual(toolCase.body);
			if (toolCase.name === "investbrain_create_transaction") {
				expect(JSON.parse(call?.body ?? "")).not.toHaveProperty("sale_price");
			}
			if (toolCase.name.startsWith("investbrain_delete_")) expect(result).toMatch(/^Deleted /);
			expect(JSON.stringify(result)).not.toContain(TOKEN);
		}
	});

	it("sends portfolio list filters as Investbrain query parameters", async () => {
		const mocked = mockFetch(() => Response.json({ data: [] }));
		const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
		const tool = investbrainTools.find((item) => item.name === "investbrain_list_portfolios");
		await tool?.call(client, {
			page: 2,
			itemsPerPage: 5,
			search: "retire",
			sortBy: "title",
			sortDesc: true,
			holdings_symbol: "AAPL",
		});
		const url = new URL(mocked.calls[0]?.url ?? "");
		expect(url.searchParams.get("page")).toBe("2");
		expect(url.searchParams.get("itemsPerPage")).toBe("5");
		expect(url.searchParams.get("search")).toBe("retire");
		expect(url.searchParams.get("sortBy")).toBe("title");
		expect(url.searchParams.get("sortDesc")).toBe("true");
		expect(url.searchParams.get("filter[holdings.symbol]")).toBe("AAPL");
	});

	it("sends dividend list filters as Investbrain query parameters", async () => {
		const mocked = mockFetch(() => Response.json({ data: [] }));
		const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
		const tool = investbrainTools.find((item) => item.name === "investbrain_list_dividends");
		await tool?.call(client, {
			page: 2,
			itemsPerPage: 25,
			search: "petr",
			sort: "-date, symbol",
			symbol: "PETR4.SA, VALE3.SA",
			source: "manual",
			date: "2024-08-15",
		});
		const url = new URL(mocked.calls[0]?.url ?? "");
		expect(url.searchParams.get("page")).toBe("2");
		expect(url.searchParams.get("itemsPerPage")).toBe("25");
		expect(url.searchParams.get("search")).toBe("petr");
		expect(url.searchParams.get("sort")).toBe("-date,symbol");
		expect(url.searchParams.get("filter[symbol]")).toBe("PETR4.SA,VALE3.SA");
		expect(url.searchParams.get("filter[source]")).toBe("manual");
		expect(url.searchParams.get("filter[date]")).toBe("2024-08-15");
		expect(url.searchParams.get("sortBy")).toBeNull();
		expect(url.searchParams.get("sortDesc")).toBeNull();
	});

	it("rejects dividend writes and list filters that Investbrain would reject", async () => {
		const mocked = mockFetch(() => Response.json({ ok: true }));
		const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
		const create = investbrainTools.find((item) => item.name === "investbrain_create_dividend");
		const update = investbrainTools.find((item) => item.name === "investbrain_update_dividend");
		const list = investbrainTools.find((item) => item.name === "investbrain_list_dividends");
		if (create === undefined || update === undefined || list === undefined) throw new Error("missing dividend tool");

		const valid = { symbol: "PETR4.SA", date: "2024-08-15", dividend_amount: 0.85 };
		expect(() => create.call(client, { symbol: "PETR4.SA", date: "2024-08-15" })).toThrow(/dividend_amount/);
		expect(() => create.call(client, { ...valid, dividend_amount: 0 })).toThrow();
		expect(() => create.call(client, { ...valid, dividend_amount: -1 })).toThrow();
		expect(() => create.call(client, { ...valid, dividend_amount: 1.234567891 })).toThrow(/8 decimal/);
		expect(() => create.call(client, { ...valid, date: "2024-02-31" })).toThrow(/calendar date/);
		expect(() => create.call(client, { ...valid, date: "15/08/2024" })).toThrow();
		expect(() => update.call(client, { id: DIVIDEND_ID })).toThrow(/symbol, date, or dividend_amount/);
		expect(() => list.call(client, { itemsPerPage: -1 })).toThrow();
		expect(() => list.call(client, { itemsPerPage: 101 })).toThrow();
		expect(() => list.call(client, { sort: "price" })).toThrow(/sort must list/);
		expect(() => list.call(client, { source: "yahoo" })).toThrow();
		expect(() => list.call(client, { symbol: "THIS_TICKER_IS_LONGER_THAN_25" })).toThrow(/25/);
		expect(mocked.calls).toHaveLength(0);

		await create.call(client, { ...valid, dividend_amount: 1.23456789 });
		expect(JSON.parse(mocked.calls[0]?.body ?? "")).toEqual({
			...valid,
			dividend_amount: 1.23456789,
		});
		expect(JSON.parse(mocked.calls[0]?.body ?? "")).not.toHaveProperty("source");
	});

	it("requires cost_basis for BUY and sale_price for SELL", async () => {
		const tool = investbrainTools.find((item) => item.name === "investbrain_create_transaction");
		if (tool === undefined) throw new Error("missing create transaction");
		const mocked = mockFetch(() => Response.json({ ok: true }));
		const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
		const base = {
			portfolio_id: PORTFOLIO_ID,
			symbol: "AAPL",
			date: "2026-10-01",
			quantity: 2,
			currency: "USD",
		};
		expect(() => tool.call(client, { ...base, transaction_type: "BUY" })).toThrow(/cost_basis/);
		expect(() => tool.call(client, { ...base, transaction_type: "SELL" })).toThrow(/sale_price/);
		expect(() => tool.call(client, { ...base, transaction_type: "BUY", cost_basis: 1, sale_price: 2 })).toThrow(
			/sale_price/,
		);
		expect(() => tool.call(client, { ...base, transaction_type: "SELL", sale_price: 2, cost_basis: 1 })).toThrow(
			/cost_basis/,
		);
		expect(mocked.calls).toHaveLength(0);

		await tool.call(client, { ...base, transaction_type: "SELL", sale_price: 20 });
		expect(JSON.parse(mocked.calls[0]?.body ?? "")).toEqual({
			...base,
			transaction_type: "SELL",
			sale_price: 20,
		});
	});

	it("returns a tool error that does not include the token when Investbrain rejects the call", async () => {
		const mocked = mockFetch(
			() => new Response(JSON.stringify({ message: `unauthenticated ${TOKEN}` }), { status: 401 }),
		);
		const client = new InvestbrainClient(BASE_URL, TOKEN, mocked.fetch);
		await expect(investbrainTools[0]?.call(client, {})).rejects.toThrow(/\[redacted\]/);
	});
});
