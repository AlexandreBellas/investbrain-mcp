import { readFileSync, writeFileSync } from "node:fs";

// wrangler types turns the empty placeholder into the literal type "".
// The value is injected at deploy time, so the binding is a string.
const file = "worker-configuration.d.ts";
const text = readFileSync(file, "utf8");
const next = text.replace('INVESTBRAIN_BASE_URL: "";', "INVESTBRAIN_BASE_URL: string;");
if (next === text && !text.includes("INVESTBRAIN_BASE_URL: string;")) {
	console.error("Could not widen INVESTBRAIN_BASE_URL in worker-configuration.d.ts");
	process.exit(1);
}
writeFileSync(file, next);
