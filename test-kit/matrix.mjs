// Runs the movement stress matrix: calm/chaos x clean/mild/bad network x
// one terrain/split, 6 players (all four camera modes each run), DM camera
// rotating ortho/perspective/freecam. Then: node test-kit/analyze.mjs
//   node test-kit/matrix.mjs [--seconds 60]
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const seconds = args.includes("--seconds") ? args[args.indexOf("--seconds") + 1] : "60";
const dmModes = ["ortho", "perspective", "freecam"];
let i = 0;
for (const chaos of [false, true])
	for (const net of ["clean", "mild", "bad"])
		for (const split of [false, true]) {
			const label = `m-${chaos ? "chaos" : "calm"}-${net}-${split ? "split" : "one"}`;
			const argv = ["test-kit/run.mjs", "test-kit/scenarios/stress.mjs", "--players", "6", "--seconds", seconds, "--label", label, "--dm-mode", dmModes[i++ % 3]];
			if (chaos) argv.push("--chaos");
			if (net !== "clean") argv.push("--net", net);
			if (split) argv.push("--split");
			console.log(`\n=== ${label} ===`);
			const r = spawnSync("node", argv, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
			const out = (r.stdout + r.stderr).split("\n").filter((l) => /^(DM|P\d) |desync|FAILED|passed|error/.test(l));
			console.log(out.join("\n"));
		}
