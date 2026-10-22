// CLI for the test kit.
//
//   node test-kit/run.mjs <scenario.mjs> [--players N] [--headed] [--verbose]
//       Start the kit, run the scenario's default export `async (kit) => {}`, exit.
//   node test-kit/run.mjs --serve [--players N] [--headed]
//       Start the kit and keep it up. POST JavaScript to http://localhost:3199/run
//       (or use test-kit/send.mjs); the body runs as `async (kit) => { <body> }`
//       and whatever it returns comes back as JSON.
//   node test-kit/run.mjs --seed
//       Rebuild test-kit/kitchen-sink.json from test-kit/seed.mjs.
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startKit } from "./kit.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const players = Number(option("players", 2));
const headed = flag("headed");
const verbose = flag("verbose");
const SERVE_PORT = 3199;

if (flag("seed")) {
	const { seed } = await import("./seed.mjs");
	const kit = await startKit({ fixture: null, headed, verbose });
	try {
		await seed(kit);
	} finally {
		await kit.close();
	}
} else if (flag("serve")) {
	const kit = await startKit({ players, headed, verbose });
	const AsyncFunction = (async () => {}).constructor;
	http
		.createServer((req, res) => {
			if (req.method !== "POST" || req.url !== "/run") {
				res.writeHead(404).end();
				return;
			}
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", async () => {
				try {
					const result = await new AsyncFunction("kit", body)(kit);
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: true, result: result ?? null }, null, 2));
				} catch (error) {
					res.writeHead(500, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: String(error?.stack ?? error) }));
				}
			});
		})
		.listen(SERVE_PORT, "127.0.0.1");
	console.log(
		`test kit up: DM + ${kit.players.length} players at ${kit.baseUrl}; send code to http://127.0.0.1:${SERVE_PORT}/run`
	);
	const shutdown = async () => {
		await kit.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
} else {
	const scenario = args.find((a) => !a.startsWith("--") && a.endsWith(".mjs"));
	if (!scenario) {
		console.error("usage: node test-kit/run.mjs <scenario.mjs> | --serve | --seed");
		process.exit(2);
	}
	// A scenario may export `options` (e.g. { characters: [...] }) for startKit.
	const { default: run, options = {} } = await import(pathToFileURL(path.resolve(scenario)).href);
	const kit = await startKit({ players, headed, verbose, ...options });
	let failed = false;
	try {
		await run(kit);
		console.log("scenario passed");
	} catch (error) {
		failed = true;
		console.error("scenario FAILED:", error);
		for (const peer of kit.peers()) await peer.shot("failure").catch(() => {});
	} finally {
		await kit.close();
	}
	process.exit(failed ? 1 : 0);
}
