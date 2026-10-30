import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("inject-base-url", () => {
	it("replaces the empty placeholder and refuses a missing URL", () => {
		const dir = mkdtempSync(join(tmpdir(), "investbrain-mcp-"));
		const file = join(dir, "wrangler.jsonc");
		writeFileSync(file, '{\n\t"vars": {\n\t\t"INVESTBRAIN_BASE_URL": ""\n\t}\n}\n');

		const missing = spawnSync(process.execPath, ["scripts/inject-base-url.mjs", file], {
			env: { ...process.env, INVESTBRAIN_BASE_URL: "" },
			encoding: "utf8",
		});
		expect(missing.status).not.toBe(0);
		expect(readFileSync(file, "utf8")).toContain('"INVESTBRAIN_BASE_URL": ""');

		const url = "https://investbrain.example.com/app";
		const ok = spawnSync(process.execPath, ["scripts/inject-base-url.mjs", file], {
			env: { ...process.env, INVESTBRAIN_BASE_URL: url },
			encoding: "utf8",
		});
		expect(ok.status).toBe(0);
		expect(ok.stdout).toBe("");
		expect(readFileSync(file, "utf8")).toContain(`"INVESTBRAIN_BASE_URL": ${JSON.stringify(url)}`);
	});
});
