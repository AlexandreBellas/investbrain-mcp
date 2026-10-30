import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(env: Record<string, string>) {
	return spawnSync(process.execPath, ["scripts/apply-deploy-vars.mjs"], {
		env: { ...process.env, DEPLOY_ARGS_ONLY: "1", ...env },
		encoding: "utf8",
	});
}

describe("apply-deploy-vars", () => {
	it("passes the base URL and optional hostnames as wrangler --var flags", () => {
		const urlOnly = run({ INVESTBRAIN_BASE_URL: "https://investbrain.example.com/app", ALLOWED_HOSTNAMES: "" });
		expect(urlOnly.status).toBe(0);
		expect(JSON.parse(urlOnly.stdout)).toEqual([
			"deploy",
			"--var",
			"INVESTBRAIN_BASE_URL:https://investbrain.example.com/app",
		]);

		const withHosts = run({
			INVESTBRAIN_BASE_URL: "https://investbrain.example.com",
			ALLOWED_HOSTNAMES: " mcp.example.com ",
		});
		expect(withHosts.status).toBe(0);
		expect(JSON.parse(withHosts.stdout)).toEqual([
			"deploy",
			"--var",
			"INVESTBRAIN_BASE_URL:https://investbrain.example.com",
			"--var",
			"ALLOWED_HOSTNAMES:mcp.example.com",
		]);
	});

	it("refuses a missing URL before wrangler runs", () => {
		const missing = run({ INVESTBRAIN_BASE_URL: "" });
		expect(missing.status).not.toBe(0);
		expect(missing.stderr).toContain("INVESTBRAIN_BASE_URL");
		expect(missing.stdout).toBe("");
	});
});