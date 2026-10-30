import { USER_AGENT } from "./constants";

export class InvestbrainConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvestbrainConfigError";
	}
}

export class InvestbrainApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "InvestbrainApiError";
	}
}

export type ListQuery = {
	page?: number;
	itemsPerPage?: number;
	search?: string;
	sortBy?: string;
	sortDesc?: boolean;
	holdingsSymbol?: string;
};

export type PortfolioWrite = {
	title?: string;
	notes?: string | null;
	wishlist?: boolean | null;
};

export type TransactionWrite = {
	portfolio_id?: string;
	symbol?: string;
	transaction_type?: "BUY" | "SELL";
	date?: string;
	quantity?: number;
	currency?: string;
	cost_basis?: number;
	sale_price?: number;
};

/**
 * Origin of a self-hosted Investbrain app. Credentials, query, and fragment are rejected
 * so the bearer token cannot be combined with a URL that already carries a secret.
 */
export function resolveBaseUrl(raw: string | undefined): string {
	if (raw === undefined || raw.trim() === "") {
		throw new InvestbrainConfigError(
			"INVESTBRAIN_BASE_URL is unset or empty. Set it at deploy time.",
		);
	}

	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new InvestbrainConfigError("INVESTBRAIN_BASE_URL is not a valid URL.");
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new InvestbrainConfigError("INVESTBRAIN_BASE_URL must use http or https.");
	}
	if (url.username !== "" || url.password !== "") {
		throw new InvestbrainConfigError("INVESTBRAIN_BASE_URL must not include credentials.");
	}
	if (url.search !== "" || url.hash !== "") {
		throw new InvestbrainConfigError("INVESTBRAIN_BASE_URL must not include a query or fragment.");
	}

	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path === "/" ? "" : path}`;
}

export function listQueryParams(query: ListQuery): URLSearchParams {
	const params = new URLSearchParams();
	if (query.page !== undefined) params.set("page", String(query.page));
	if (query.itemsPerPage !== undefined) params.set("itemsPerPage", String(query.itemsPerPage));
	if (query.search !== undefined && query.search !== "") params.set("search", query.search);
	if (query.sortBy !== undefined) params.set("sortBy", query.sortBy);
	if (query.sortDesc !== undefined) params.set("sortDesc", query.sortDesc ? "true" : "false");
	if (query.holdingsSymbol !== undefined && query.holdingsSymbol !== "") {
		params.set("filter[holdings.symbol]", query.holdingsSymbol);
	}
	return params;
}

/**
 * Workers throw TypeError "Illegal invocation" when the global `fetch` runs
 * with `this` set to another object. Call it through a free function.
 */
const defaultFetch: typeof fetch = (input, init) => fetch(input, init);

function freeFetch(fetchImpl: typeof fetch): typeof fetch {
	return (input, init) => fetchImpl(input, init);
}

/**
 * Calls one Investbrain API path. The token is held only for this client instance,
 * which is created per MCP request and is not written to storage or logs.
 * Redirects are not followed, so Authorization is not sent to another host.
 */
export class InvestbrainClient {
	private readonly fetchImpl: typeof fetch;

	constructor(
		private readonly baseUrl: string,
		private readonly token: string,
		fetchImpl?: typeof fetch,
	) {
		this.fetchImpl = freeFetch(fetchImpl ?? defaultFetch);
	}

	getMe() {
		return this.request("GET", "/me");
	}

	listPortfolios(query: ListQuery) {
		return this.request("GET", "/portfolio", undefined, listQueryParams(query));
	}

	getPortfolio(id: string) {
		return this.request("GET", `/portfolio/${encodeURIComponent(id)}`);
	}

	createPortfolio(body: PortfolioWrite) {
		return this.request("POST", "/portfolio", body);
	}

	updatePortfolio(id: string, body: PortfolioWrite) {
		return this.request("PUT", `/portfolio/${encodeURIComponent(id)}`, body);
	}

	deletePortfolio(id: string) {
		return this.request("DELETE", `/portfolio/${encodeURIComponent(id)}`);
	}

	listTransactions(query: ListQuery) {
		return this.request("GET", "/transaction", undefined, listQueryParams(query));
	}

	getTransaction(id: string) {
		return this.request("GET", `/transaction/${encodeURIComponent(id)}`);
	}

	createTransaction(body: TransactionWrite) {
		return this.request("POST", "/transaction", body);
	}

	updateTransaction(id: string, body: TransactionWrite) {
		return this.request("PUT", `/transaction/${encodeURIComponent(id)}`, body);
	}

	deleteTransaction(id: string) {
		return this.request("DELETE", `/transaction/${encodeURIComponent(id)}`);
	}

	listHoldings(query: ListQuery) {
		return this.request("GET", "/holding", undefined, listQueryParams(query));
	}

	getHolding(portfolioId: string, symbol: string) {
		return this.request(
			"GET",
			`/holding/${encodeURIComponent(portfolioId)}/${encodeURIComponent(symbol)}`,
		);
	}

	updateHolding(portfolioId: string, symbol: string, body: { reinvest_dividends: boolean }) {
		return this.request(
			"PUT",
			`/holding/${encodeURIComponent(portfolioId)}/${encodeURIComponent(symbol)}`,
			body,
		);
	}

	getMarketData(symbol: string) {
		return this.request("GET", `/market-data/${encodeURIComponent(symbol)}`);
	}

	private async request(
		method: string,
		path: string,
		body?: unknown,
		query?: URLSearchParams,
	): Promise<unknown> {
		const url = new URL(`${this.baseUrl}/api${path}`);
		if (query !== undefined) {
			for (const [key, value] of query.entries()) url.searchParams.append(key, value);
		}

		const headers = new Headers({
			Accept: "application/json",
			Authorization: `Bearer ${this.token}`,
			"User-Agent": USER_AGENT,
		});
		let payload: string | undefined;
		if (body !== undefined) {
			headers.set("Content-Type", "application/json");
			payload = JSON.stringify(body);
		}

		let response: Response;
		const fetchImpl = this.fetchImpl;
		try {
			response = await fetchImpl(url, {
				method,
				headers,
				body: payload,
				redirect: "manual",
			});
		} catch (error) {
			const name = error instanceof Error ? error.name : "NonError";
			const detail = error instanceof Error ? redact(error.message, this.token) : "non-error throw";
			console.error(
				JSON.stringify({
					message: "Investbrain request failed",
					name,
					error: detail.slice(0, 500),
				}),
			);
			throw new InvestbrainApiError("Investbrain could not be reached.", 0);
		}

		const text = await response.text();
		if (response.status >= 300 && response.status < 400) {
			throw new InvestbrainApiError(
				`Investbrain API returned ${response.status} and redirects are not followed.`,
				response.status,
			);
		}
		if (!response.ok) {
			throw new InvestbrainApiError(formatApiError(response.status, text, this.token), response.status);
		}
		if (response.status === 204 || text.length === 0) return null;
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw new InvestbrainApiError(
				`Investbrain API returned ${response.status} with a non-JSON body.`,
				response.status,
			);
		}
	}
}

function formatApiError(status: number, text: string, token: string): string {
	const safe = redact(text, token).slice(0, 2_000);
	try {
		const parsed = JSON.parse(safe) as { message?: unknown; errors?: unknown };
		const parts: string[] = [];
		if (typeof parsed.message === "string" && parsed.message.length > 0) {
			parts.push(parsed.message);
		}
		if (parsed.errors !== null && typeof parsed.errors === "object") {
			for (const [field, messages] of Object.entries(parsed.errors)) {
				const textMessages = Array.isArray(messages)
					? messages.filter((item): item is string => typeof item === "string")
					: [];
				if (textMessages.length > 0) parts.push(`${field}: ${textMessages.join(", ")}`);
			}
		}
		if (parts.length > 0) return `Investbrain API returned ${status}: ${parts.join("; ")}`;
	} catch {
		// Fall through to the truncated body.
	}
	return safe.length > 0
		? `Investbrain API returned ${status}: ${safe}`
		: `Investbrain API returned ${status}.`;
}

function redact(text: string, token: string): string {
	if (token.length === 0) return text;
	return text.split(token).join("[redacted]");
}
