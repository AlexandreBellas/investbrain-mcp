const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

const HOSTNAME =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Hostnames the MCP handler should accept in addition to its defaults.
 * Returns undefined when nothing extra is configured, so the handler keeps
 * the workers.dev and localhost defaults. A non-empty list replaces those
 * defaults, so the result includes them again.
 */
export function mcpHostAllowlist(requestUrl: string, raw: string | undefined): string[] | undefined {
	const configured = parseAllowedHostnames(raw);
	if (configured.length === 0) return undefined;

	const hosts = new Set<string>([...LOCAL_HOSTS, ...configured]);
	const hostname = new URL(requestUrl).hostname.toLowerCase();
	if (hostname.endsWith(".workers.dev")) hosts.add(hostname);
	return [...hosts];
}

function parseAllowedHostnames(raw: string | undefined): string[] {
	if (raw === undefined) return [];
	const hosts: string[] = [];
	for (const part of raw.split(",")) {
		const host = part.trim().toLowerCase();
		if (host.length === 0) continue;
		if (!HOSTNAME.test(host)) {
			console.error(
				JSON.stringify({
					message: "Ignoring invalid ALLOWED_HOSTNAMES entry",
					entry: host.slice(0, 253),
				}),
			);
			continue;
		}
		if (!hosts.includes(host)) hosts.push(host);
	}
	return hosts;
}
