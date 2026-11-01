import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	InvestbrainApiError,
	type DividendListQuery,
	type DividendWrite,
	type InvestbrainClient,
	type ListQuery,
	type PortfolioWrite,
	type TransactionWrite,
} from "./investbrain";

const portfolioId = z.uuid().describe("Portfolio UUID.");
const transactionId = z.uuid().describe("Transaction UUID.");
const dividendId = z.uuid().describe("Dividend UUID.");
const symbol = z
	.string()
	.trim()
	.min(1)
	.max(25)
	.describe("Ticker symbol as stored by Investbrain, for example AAPL. Maximum length is 25.");
const title = z
	.string()
	.trim()
	.min(5)
	.max(255)
	.describe("Portfolio title. Investbrain requires 5 to 255 characters.");
const notes = z
	.string()
	.max(20_000)
	.nullable()
	.describe("Portfolio notes. Send null to clear them.");
const wishlist = z
	.boolean()
	.nullable()
	.describe("When true, Investbrain treats the portfolio as a wishlist.");
const tradeDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.describe(
		"Trade date in YYYY-MM-DD. Investbrain rejects a date after today in the app timezone.",
	);
const quantity = z
	.number()
	.gt(0)
	.describe(
		"Share quantity, greater than 0. A SELL cannot exceed shares of that symbol already owned in the portfolio before this date.",
	);
const currency = z
	.string()
	.trim()
	.min(1)
	.max(12)
	.describe("Currency code that exists in Investbrain's currencies table, for example USD.");
const page = z
	.number()
	.int()
	.min(1)
	.max(100_000)
	.optional()
	.describe("Results page. Investbrain starts at 1.");
const itemsPerPage = z
	.number()
	.int()
	.refine((value) => value === -1 || (value >= 1 && value <= 100), {
		message: "itemsPerPage must be -1 (every row) or from 1 to 100.",
	})
	.optional()
	.describe("Page size. Investbrain's default is 15. -1 asks for every matching row.");
const dividendItemsPerPage = z
	.number()
	.int()
	.min(1)
	.max(100)
	.optional()
	.describe("Page size from 1 to 100. Investbrain's default is 15. Dividend lists do not accept -1.");
const sortBy = z
	.string()
	.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
	.optional()
	.describe("Column to sort by, for example created_at.");
const sortDesc = z
	.boolean()
	.optional()
	.describe("When true, sort descending. Sent to Investbrain as sortDesc=true.");

const readOnly = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const createHints = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
} as const;

const updateHints = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const deleteHints = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;

type ToolResult = {
	content: [{ type: "text"; text: string }];
	isError?: boolean;
};

export type InvestbrainTool = {
	name: string;
	title: string;
	description: string;
	annotations: {
		readOnlyHint: boolean;
		destructiveHint: boolean;
		idempotentHint: boolean;
		openWorldHint: boolean;
	};
	inputSchema: z.ZodType;
	call: (client: InvestbrainClient, args: unknown) => Promise<unknown>;
};

function listFields(search: string) {
	return {
		page,
		itemsPerPage,
		search: z.string().max(200).optional().describe(search),
		sortBy,
		sortDesc,
	};
}

function listQuery(args: {
	page?: number;
	itemsPerPage?: number;
	search?: string;
	sortBy?: string;
	sortDesc?: boolean;
	holdings_symbol?: string;
}): ListQuery {
	return {
		page: args.page,
		itemsPerPage: args.itemsPerPage,
		search: args.search,
		sortBy: args.sortBy,
		sortDesc: args.sortDesc,
		holdingsSymbol: args.holdings_symbol,
	};
}

function definedPortfolio(args: {
	title?: string;
	notes?: string | null;
	wishlist?: boolean | null;
}): PortfolioWrite {
	const body: PortfolioWrite = {};
	if (args.title !== undefined) body.title = args.title;
	if (args.notes !== undefined) body.notes = args.notes;
	if (args.wishlist !== undefined) body.wishlist = args.wishlist;
	return body;
}

const portfolioListSchema = z.object({
	...listFields("Case-insensitive match against portfolio title and notes."),
	holdings_symbol: symbol
		.optional()
		.describe("Keep portfolios that hold this symbol. Sent as filter[holdings.symbol]."),
});

const transactionListSchema = z.object(
	listFields("Case-insensitive match against the transaction symbol."),
);

const holdingListSchema = z.object(listFields("Case-insensitive match against the holding symbol."));

const portfolioCreateSchema = z.object({
	title,
	notes: notes.optional(),
	wishlist: wishlist.optional(),
});

const portfolioUpdateSchema = z
	.object({
		id: portfolioId,
		title: title.optional(),
		notes: notes.optional(),
		wishlist: wishlist.optional(),
	})
	.refine((value) => value.title !== undefined || value.notes !== undefined || value.wishlist !== undefined, {
		message: "Provide title, notes, or wishlist to update.",
	});

const transactionCreateSchema = z
	.object({
		portfolio_id: portfolioId,
		symbol,
		transaction_type: z
			.enum(["BUY", "SELL"])
			.describe("BUY requires cost_basis. SELL requires sale_price."),
		date: tradeDate,
		quantity,
		currency,
		cost_basis: z
			.number()
			.min(0)
			.optional()
			.describe("Required for BUY. Omit it for a SELL."),
		sale_price: z
			.number()
			.min(0)
			.optional()
			.describe("Required for SELL. Omit it for a BUY."),
	})
	.superRefine((value, ctx) => {
		if (value.transaction_type === "BUY") {
			if (value.cost_basis === undefined) {
				ctx.addIssue({
					code: "custom",
					message: "BUY requires cost_basis.",
					path: ["cost_basis"],
				});
			}
			if (value.sale_price !== undefined) {
				ctx.addIssue({
					code: "custom",
					message: "BUY must not include sale_price.",
					path: ["sale_price"],
				});
			}
			return;
		}
		if (value.sale_price === undefined) {
			ctx.addIssue({
				code: "custom",
				message: "SELL requires sale_price.",
				path: ["sale_price"],
			});
		}
		if (value.cost_basis !== undefined) {
			ctx.addIssue({
				code: "custom",
				message: "SELL must not include cost_basis.",
				path: ["cost_basis"],
			});
		}
	});

const transactionUpdateSchema = z
	.object({
		id: transactionId,
		portfolio_id: portfolioId.optional(),
		symbol: symbol.optional(),
		transaction_type: z.enum(["BUY", "SELL"]).optional(),
		date: tradeDate.optional(),
		quantity: quantity.optional(),
		currency: currency.optional(),
		cost_basis: z
			.number()
			.min(0)
			.optional()
			.describe("Cost basis. Investbrain ignores it when the resulting type is SELL."),
		sale_price: z
			.number()
			.min(0)
			.optional()
			.describe("Sale price. Investbrain ignores it when the resulting type is BUY."),
	})
	.refine(
		(value) =>
			value.portfolio_id !== undefined ||
			value.symbol !== undefined ||
			value.transaction_type !== undefined ||
			value.date !== undefined ||
			value.quantity !== undefined ||
			value.currency !== undefined ||
			value.cost_basis !== undefined ||
			value.sale_price !== undefined,
		{ message: "Provide at least one transaction field to update." },
	);

function transactionBody(args: {
	portfolio_id?: string;
	symbol?: string;
	transaction_type?: "BUY" | "SELL";
	date?: string;
	quantity?: number;
	currency?: string;
	cost_basis?: number;
	sale_price?: number;
}): TransactionWrite {
	const body: TransactionWrite = {};
	if (args.portfolio_id !== undefined) body.portfolio_id = args.portfolio_id;
	if (args.symbol !== undefined) body.symbol = args.symbol;
	if (args.transaction_type !== undefined) body.transaction_type = args.transaction_type;
	if (args.date !== undefined) body.date = args.date;
	if (args.quantity !== undefined) body.quantity = args.quantity;
	if (args.currency !== undefined) body.currency = args.currency;
	if (args.cost_basis !== undefined) body.cost_basis = args.cost_basis;
	if (args.sale_price !== undefined) body.sale_price = args.sale_price;
	return body;
}

const DIVIDEND_SORT_COLUMNS = new Set([
	"symbol",
	"date",
	"dividend_amount",
	"source",
	"created_at",
	"updated_at",
]);
const DIVIDEND_AMOUNT_MAX = 999_999_999_999;

function isCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (match === null) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function hasAtMostEightDecimalPlaces(value: number): boolean {
	return Number.isFinite(value) && Number(value.toFixed(8)) === value;
}

function commaSeparated(value: string): string {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(",");
}

const entitlementDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine(isCalendarDate, { message: "date must be a real calendar date in YYYY-MM-DD." })
	.describe(
		"Inclusive entitlement date in YYYY-MM-DD. For B3 this is data-com, not the payment date and not Yahoo's ex-date. Shares bought or sold on this date count. One dividend row exists per symbol per date.",
	);
const dividendAmount = z
	.number()
	.gt(0)
	.max(DIVIDEND_AMOUNT_MAX)
	.refine(hasAtMostEightDecimalPlaces, {
		message: "dividend_amount must have at most 8 decimal places.",
	})
	.describe(
		"Gross per-share amount in the symbol's trading currency. Greater than 0, at most 999999999999, at most 8 decimal places. The app does not withhold tax. For B3, sum same-day proventos (dividendo, JCP, and any other provento) into this one number.",
	);
const dividendSort = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.refine(
		(value) =>
			value.split(",").every((part) => {
				const column = part.trim();
				if (column.length === 0) return false;
				const name = column.startsWith("-") ? column.slice(1) : column;
				return DIVIDEND_SORT_COLUMNS.has(name);
			}),
		{
			message:
				"sort must list symbol, date, dividend_amount, source, created_at, or updated_at, separated by commas. Prefix a column with - to sort descending.",
		},
	)
	.optional()
	.describe(
		"Comma-separated columns: symbol, date, dividend_amount, source, created_at, updated_at. Prefix a column with - for descending, for example -date. Default order is date descending, then id ascending.",
	);
const dividendFilterSymbol = z
	.string()
	.trim()
	.min(1)
	.max(5_000)
	.refine(
		(value) =>
			value.split(",").every((part) => {
				const ticker = part.trim();
				return ticker.length >= 1 && ticker.length <= 25;
			}),
		{ message: "symbol must be one ticker or a comma-separated list. Each ticker is 1 to 25 characters." },
	)
	.optional()
	.describe(
		"One ticker or a comma-separated list. Sent as filter[symbol]. Matched case-insensitively.",
	);

const dividendListSchema = z.object({
	page,
	itemsPerPage: dividendItemsPerPage,
	search: z
		.string()
		.max(255)
		.optional()
		.describe("Case-insensitive partial match against the symbol. Maximum length is 255."),
	sort: dividendSort,
	symbol: dividendFilterSymbol,
	source: z
		.enum(["sync", "manual"])
		.optional()
		.describe("Sent as filter[source]. sync is a provider row. manual was created or edited by hand."),
	date: entitlementDate
		.optional()
		.describe("Exact entitlement date, YYYY-MM-DD. Sent as filter[date]. For B3 this is data-com."),
});

const dividendCreateSchema = z.object({
	symbol,
	date: entitlementDate,
	dividend_amount: dividendAmount,
});

const dividendUpdateSchema = z
	.object({
		id: dividendId,
		symbol: symbol.optional(),
		date: entitlementDate.optional(),
		dividend_amount: dividendAmount.optional(),
	})
	.refine(
		(value) => value.symbol !== undefined || value.date !== undefined || value.dividend_amount !== undefined,
		{ message: "Provide symbol, date, or dividend_amount to update." },
	);

function dividendListQuery(args: {
	page?: number;
	itemsPerPage?: number;
	search?: string;
	sort?: string;
	symbol?: string;
	source?: "sync" | "manual";
	date?: string;
}): DividendListQuery {
	return {
		page: args.page,
		itemsPerPage: args.itemsPerPage,
		search: args.search,
		sort: args.sort === undefined ? undefined : commaSeparated(args.sort),
		symbol: args.symbol === undefined ? undefined : commaSeparated(args.symbol),
		source: args.source,
		date: args.date,
	};
}

function dividendBody(args: {
	symbol?: string;
	date?: string;
	dividend_amount?: number;
}): DividendWrite {
	const body: DividendWrite = {};
	if (args.symbol !== undefined) body.symbol = args.symbol;
	if (args.date !== undefined) body.date = args.date;
	if (args.dividend_amount !== undefined) body.dividend_amount = args.dividend_amount;
	return body;
}

export const investbrainTools: InvestbrainTool[] = [
	{
		name: "investbrain_get_me",
		title: "Get current user",
		description:
			"GET /api/me. Returns the Investbrain user for the Sanctum token on this request: id, name, email, profile photo URL, display currency, and locale.",
		annotations: readOnly,
		inputSchema: z.object({}),
		call: (client) => client.getMe(),
	},
	{
		name: "investbrain_list_portfolios",
		title: "List portfolios",
		description:
			"GET /api/portfolio. Lists portfolios the token's user can access. Supports page, itemsPerPage, search (title and notes), sortBy, sortDesc, and holdings_symbol.",
		annotations: readOnly,
		inputSchema: portfolioListSchema,
		call: (client, args) => client.listPortfolios(listQuery(portfolioListSchema.parse(args))),
	},
	{
		name: "investbrain_get_portfolio",
		title: "Get portfolio",
		description: "GET /api/portfolio/{portfolio}. Returns one portfolio the token's user can read, including its owner.",
		annotations: readOnly,
		inputSchema: z.object({ id: portfolioId }),
		call: (client, args) => client.getPortfolio(z.object({ id: portfolioId }).parse(args).id),
	},
	{
		name: "investbrain_create_portfolio",
		title: "Create portfolio",
		description:
			"POST /api/portfolio. Creates a portfolio owned by the token's user. title is required (5 to 255 characters). notes and wishlist are optional.",
		annotations: createHints,
		inputSchema: portfolioCreateSchema,
		call: (client, args) => client.createPortfolio(definedPortfolio(portfolioCreateSchema.parse(args))),
	},
	{
		name: "investbrain_update_portfolio",
		title: "Update portfolio",
		description:
			"Destructive: PUT /api/portfolio/{portfolio}. Changes title, notes, and/or wishlist on a portfolio the token's user can fully access. Omitted fields stay as they are. Investbrain accepts PUT and PATCH on this route; this tool sends PUT. title, when sent, must be 5 to 255 characters.",
		annotations: updateHints,
		inputSchema: portfolioUpdateSchema,
		call: (client, args) => {
			const parsed = portfolioUpdateSchema.parse(args);
			return client.updatePortfolio(parsed.id, definedPortfolio(parsed));
		},
	},
	{
		name: "investbrain_delete_portfolio",
		title: "Delete portfolio",
		description:
			"Destructive: DELETE /api/portfolio/{portfolio}. Permanently deletes the portfolio. Investbrain cascades that delete to its holdings and transactions. Requires full access. This cannot be undone by the MCP server.",
		annotations: deleteHints,
		inputSchema: z.object({ id: portfolioId }),
		call: async (client, args) => {
			const { id } = z.object({ id: portfolioId }).parse(args);
			await client.deletePortfolio(id);
			return `Deleted portfolio ${id}.`;
		},
	},
	{
		name: "investbrain_list_transactions",
		title: "List transactions",
		description:
			"GET /api/transaction. Lists transactions the token's user can access. Supports page, itemsPerPage, search (symbol), sortBy, and sortDesc.",
		annotations: readOnly,
		inputSchema: transactionListSchema,
		call: (client, args) => client.listTransactions(listQuery(transactionListSchema.parse(args))),
	},
	{
		name: "investbrain_get_transaction",
		title: "Get transaction",
		description: "GET /api/transaction/{transaction}. Returns one transaction on a portfolio the token's user can read.",
		annotations: readOnly,
		inputSchema: z.object({ id: transactionId }),
		call: (client, args) => client.getTransaction(z.object({ id: transactionId }).parse(args).id),
	},
	{
		name: "investbrain_create_transaction",
		title: "Create transaction",
		description:
			"POST /api/transaction. Records a BUY or SELL on a portfolio the token's user can fully access. Requires portfolio_id, symbol, transaction_type (BUY or SELL), date (YYYY-MM-DD, not after today), quantity > 0, and currency. BUY requires cost_basis and must not include sale_price. SELL requires sale_price and must not include cost_basis. A SELL cannot exceed shares owned before that date. The symbol must exist in Investbrain market data or at its configured provider.",
		annotations: createHints,
		inputSchema: transactionCreateSchema,
		call: (client, args) => {
			const parsed = transactionCreateSchema.parse(args);
			return client.createTransaction(transactionBody(parsed));
		},
	},
	{
		name: "investbrain_update_transaction",
		title: "Update transaction",
		description:
			"Destructive: PUT /api/transaction/{transaction}. Changes one or more fields on a transaction the token's user can fully access. Omitted fields stay as they are. Investbrain accepts PUT and PATCH on this route; this tool sends PUT. On update, portfolio_id, symbol, transaction_type, date, quantity, and currency are optional. If the resulting type is SELL and sale_price is still empty, Investbrain requires sale_price. If the resulting type is BUY and cost_basis is still empty, Investbrain requires cost_basis. cost_basis is ignored for SELL and sale_price is ignored for BUY. A SELL still cannot exceed shares owned before the trade date.",
		annotations: updateHints,
		inputSchema: transactionUpdateSchema,
		call: (client, args) => {
			const parsed = transactionUpdateSchema.parse(args);
			return client.updateTransaction(parsed.id, transactionBody(parsed));
		},
	},
	{
		name: "investbrain_delete_transaction",
		title: "Delete transaction",
		description:
			"Destructive: DELETE /api/transaction/{transaction}. Permanently deletes the transaction. Requires full access to its portfolio. This cannot be undone by the MCP server.",
		annotations: deleteHints,
		inputSchema: z.object({ id: transactionId }),
		call: async (client, args) => {
			const { id } = z.object({ id: transactionId }).parse(args);
			await client.deleteTransaction(id);
			return `Deleted transaction ${id}.`;
		},
	},
	{
		name: "investbrain_list_holdings",
		title: "List holdings",
		description:
			"GET /api/holding. Lists holdings the token's user can access, with market value and dividend fields. Supports page, itemsPerPage, search (symbol), sortBy, and sortDesc.",
		annotations: readOnly,
		inputSchema: holdingListSchema,
		call: (client, args) => client.listHoldings(listQuery(holdingListSchema.parse(args))),
	},
	{
		name: "investbrain_get_holding",
		title: "Get holding",
		description:
			"GET /api/holding/{portfolio}/{symbol}. Returns the holding for that symbol in a portfolio the token's user can read.",
		annotations: readOnly,
		inputSchema: z.object({ portfolio: portfolioId, symbol }),
		call: (client, args) => {
			const parsed = z.object({ portfolio: portfolioId, symbol }).parse(args);
			return client.getHolding(parsed.portfolio, parsed.symbol);
		},
	},
	{
		name: "investbrain_update_holding",
		title: "Update holding",
		description:
			"Destructive: PUT /api/holding/{portfolio}/{symbol}. Sets reinvest_dividends, the only field HoldingRequest accepts. Requires full access to the portfolio. Investbrain accepts PUT and PATCH on this route; this tool sends PUT.",
		annotations: updateHints,
		inputSchema: z.object({
			portfolio: portfolioId,
			symbol,
			reinvest_dividends: z
				.boolean()
				.describe("Whether dividends for this holding are reinvested."),
		}),
		call: (client, args) => {
			const parsed = z
				.object({
					portfolio: portfolioId,
					symbol,
					reinvest_dividends: z.boolean(),
				})
				.parse(args);
			return client.updateHolding(parsed.portfolio, parsed.symbol, {
				reinvest_dividends: parsed.reinvest_dividends,
			});
		},
	},
	{
		name: "investbrain_list_dividends",
		title: "List dividends",
		description:
			"GET /api/dividend. Lists dividends for symbols on portfolios the token's user belongs to (owner, full access, or read-only). Dividends are shared by every holding of a symbol, not owned by one portfolio. Each object has id, symbol, date, dividend_amount, dividend_amount_base, source (sync or manual), created_at, and updated_at. date is the inclusive entitlement date: for B3 use data-com, not the payment date and not Yahoo's ex-date. dividend_amount is the gross per-share amount in the symbol's trading currency. One row exists per symbol per date, so sum same-day proventos (dividendo, JCP, and any other provento) into that amount. dividend_amount_base is that amount in the app base currency. The response is paginated (data, links, meta). Supports page (default 1), itemsPerPage (1 to 100, default 15; -1 is not accepted), sort (comma-separated columns symbol, date, dividend_amount, source, created_at, updated_at; prefix - for descending, for example -date; default is date descending then id ascending), search (case-insensitive partial symbol match, max 255), symbol (one ticker or a comma-separated list, sent as filter[symbol]), source (sync or manual, sent as filter[source]), and date (exact YYYY-MM-DD, sent as filter[date]). An unknown sort column or filter name is a 422 from Investbrain and is returned as a tool error.",
		annotations: readOnly,
		inputSchema: dividendListSchema,
		call: (client, args) => client.listDividends(dividendListQuery(dividendListSchema.parse(args))),
	},
	{
		name: "investbrain_get_dividend",
		title: "Get dividend",
		description:
			"GET /api/dividend/{id}. Returns one dividend, unwrapped, when the token's user holds that symbol. A symbol the user does not hold is 404, so existence is not leaked. date is the inclusive entitlement date (B3 data-com, not the payment date). dividend_amount is gross per share in the trading currency. source is sync (provider) or manual (created or edited by hand). Manual rows survive the automatic Yahoo sync.",
		annotations: readOnly,
		inputSchema: z.object({ id: dividendId }),
		call: (client, args) => client.getDividend(z.object({ id: dividendId }).parse(args).id),
	},
	{
		name: "investbrain_create_dividend",
		title: "Create dividend",
		description:
			"POST /api/dividend. Creates one dividend and returns 201 with the unwrapped object. Stores source=manual. source and dividend_amount_base are ignored if sent. Requires symbol (max 25 characters, stored uppercase, must exist in Investbrain market data or at its configured provider), date (YYYY-MM-DD), and dividend_amount (greater than 0, at most 999999999999, at most 8 decimal places). date is the inclusive entitlement date: for B3 set data-com, not the payment date and not Yahoo's ex-date. Shares bought or sold on that date count toward dividends_earned; a trade the next day does not. dividend_amount is gross per share in the symbol's trading currency. The app does not withhold tax. One row per symbol per calendar date: sum same-day proventos (dividendo, JCP, and others) into a single dividend_amount. A duplicate symbol and date is 422, and that message is returned as a tool error. Requires full access or ownership of a portfolio that holds the symbol. A read-only member, or a user who does not hold the symbol, gets 403. Investbrain recalculates dividends_earned for every holding of the symbol. Creating a dividend does not create a reinvestment buy. A manual row survives the automatic Yahoo sync.",
		annotations: createHints,
		inputSchema: dividendCreateSchema,
		call: (client, args) => client.createDividend(dividendBody(dividendCreateSchema.parse(args))),
	},
	{
		name: "investbrain_update_dividend",
		title: "Update dividend",
		description:
			"Destructive: PUT /api/dividend/{id}. Changes any subset of symbol, date, and dividend_amount on a dividend the token's user can fully access. Omitted fields stay as they are. At least one of those fields is required. Investbrain accepts PUT and PATCH on this route; this tool sends PUT. The row becomes source=manual. source and dividend_amount_base are ignored. date is the inclusive entitlement date (B3 data-com). dividend_amount is gross per share in the trading currency, greater than 0, at most 8 decimal places; sum same-day proventos into one amount. One row per symbol per date. Moving the symbol or date records the old pair so Yahoo sync will not recreate it, and deletes reinvestment buys for the old symbol and date. Changing only the amount updates an existing reinvestment buy on that date when the holding has reinvest_dividends on. A read-only member gets 403. A dividend for a symbol you do not hold is 404. Moving the row onto a symbol you cannot fully access returns 403 and leaves the row unchanged. Investbrain recalculates dividends_earned. Validation failures are 422 and the API message is returned as a tool error. Manual edits survive the automatic Yahoo sync.",
		annotations: updateHints,
		inputSchema: dividendUpdateSchema,
		call: (client, args) => {
			const parsed = dividendUpdateSchema.parse(args);
			return client.updateDividend(parsed.id, dividendBody(parsed));
		},
	},
	{
		name: "investbrain_delete_dividend",
		title: "Delete dividend",
		description:
			"Destructive: DELETE /api/dividend/{id}. Permanently deletes the dividend. Investbrain responds 204 with an empty body. It remembers that symbol and date so the automatic Yahoo sync will not recreate the row, deletes reinvestment buys for that symbol and date, and recalculates dividends_earned. Requires full access. A read-only member gets 403. A dividend you cannot see is 404. This cannot be undone by the MCP server.",
		annotations: deleteHints,
		inputSchema: z.object({ id: dividendId }),
		call: async (client, args) => {
			const { id } = z.object({ id: dividendId }).parse(args);
			await client.deleteDividend(id);
			return `Deleted dividend ${id}.`;
		},
	},
	{
		name: "investbrain_get_market_data",
		title: "Get market data",
		description:
			"GET /api/market-data/{symbol}. Returns Investbrain's stored quote for the symbol: name, market value, 52-week range, dividend fields, market cap, PE, and book value. Unknown symbols come back as a 404 from Investbrain.",
		annotations: readOnly,
		inputSchema: z.object({ symbol }),
		call: (client, args) => client.getMarketData(z.object({ symbol }).parse(args).symbol),
	},
];

export function registerInvestbrainTools(server: McpServer, client: InvestbrainClient): void {
	for (const tool of investbrainTools) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: tool.annotations,
			},
			async (args) => {
				try {
					const result = await tool.call(client, args);
					return toolResult(result);
				} catch (error) {
					return toolError(error);
				}
			},
		);
	}
}

function toolResult(result: unknown): ToolResult {
	if (typeof result === "string") return { content: [{ type: "text", text: result }] };
	return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

function toolError(error: unknown): ToolResult {
	const text =
		error instanceof InvestbrainApiError || error instanceof Error
			? error.message
			: "Investbrain request failed.";
	return { isError: true, content: [{ type: "text", text }] };
}
