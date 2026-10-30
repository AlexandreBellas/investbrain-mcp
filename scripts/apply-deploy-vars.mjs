import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/**
 * Workers Builds build variables are not runtime bindings.
 * `wrangler deploy --var` overrides the empty placeholders in wrangler.jsonc.
 * The value is split on the first colon, so an https URL stays intact.
 */
export function wranglerDeployArgs(env, command = "deploy") {
	const url = env.INVESTBRAIN_BASE_URL ?? "";
	if (!/^https?:\/\/\S+$/.test(url)) {
		return {
			ok: false,
			error: "INVESTBRAIN_BASE_URL is missing or is not an http(s) URL.",
		};
	}

	const args = [command, "--var", `INVESTBRAIN_BASE_URL:${url}`];
	const hosts = (env.ALLOWED_HOSTNAMES ?? "").trim();
	if (hosts !== "") args.push("--var", `ALLOWED_HOSTNAMES:${hosts}`);
	return { ok: true, args };
}

function isDirectRun() {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
	const parsed = wranglerDeployArgs(process.env);
	if (process.env.DEPLOY_ARGS_ONLY === "1") {
		if (!parsed.ok) console.error(parsed.error);
		else process.stdout.write(`${JSON.stringify(parsed.args)}\n`);
		process.exit(parsed.ok ? 0 : 1);
	}
	if (!parsed.ok) {
		console.error(parsed.error);
		process.exit(1);
	}

	const wranglerBin = join(dirname(fileURLToPath(import.meta.url)), "../node_modules/wrangler/bin/wrangler.js");
	const result = spawnSync(process.execPath, [wranglerBin, ...parsed.args], { stdio: "inherit" });
	process.exit(result.status === null ? 1 : result.status);
}
