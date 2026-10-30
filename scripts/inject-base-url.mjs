import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "wrangler.jsonc";
const url = process.env.INVESTBRAIN_BASE_URL ?? "";

if (!/^https?:\/\/\S+$/.test(url)) {
	console.error("INVESTBRAIN_BASE_URL secret is missing or is not an http(s) URL.");
	process.exit(1);
}

const needle = '"INVESTBRAIN_BASE_URL": ""';
const text = readFileSync(file, "utf8");
if (!text.includes(needle)) {
	console.error("wrangler.jsonc is missing the empty INVESTBRAIN_BASE_URL placeholder.");
	process.exit(1);
}

writeFileSync(file, text.replace(needle, `"INVESTBRAIN_BASE_URL": ${JSON.stringify(url)}`));
