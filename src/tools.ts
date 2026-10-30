import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { InvestbrainApiError, type InvestbrainClient, type ListQuery, type PortfolioWrite, type TransactionWrite } from "./investbrain";

const portfolioId = z.uuid().describe("Portfolio UUID.");
const transactionId = z.uuid().describe("Transaction UUID.");
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
