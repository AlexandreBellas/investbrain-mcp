import { readFileSync, writeFileSync } from "node:fs";

// wrangler types turns empty placeholders into the literal type "".
// Deploy overrides them with --var, so the bindings are strings.
const file = "worker-configuration.d.ts";
const text = readFileSync(file, "utf8");
const replacements = [
	['INVESTBRAIN_BASE_URL: "";', "INVESTBRAIN_BASE_URL: string;"],
	['ALLOWED_HOSTNAMES: "";', "ALLOWED_HOSTNAMES: string;"],
];
let next = text;
for (const [from, to] of replacements) {
	if (next.includes(from)) next = next.replace(from, to);
	else if (!next.includes(to)) {
		console.error(`Could not widen ${from} in worker-configuration.d.ts`);
		process.exit(1);
	}
}
writeFileSync(file, next);
