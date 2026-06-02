import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function fail(message) {
	console.error(message);
	process.exit(1);
}

const buildScript = fileURLToPath(new URL("./build-wasm.mjs", import.meta.url));
const buildResult = spawnSync(process.execPath, [buildScript], { stdio: "inherit" });
if (buildResult.error) {
	fail(`Unable to regenerate the WASM package: ${buildResult.error.message}`);
}
if (buildResult.status !== 0) {
	process.exit(buildResult.status ?? 1);
}

const statusResult = spawnSync(
	"git",
	["status", "--porcelain=v1", "--untracked-files=all", "--", "wasm/voxel-mesher/pkg"],
	{ encoding: "utf8" }
);
if (statusResult.error) {
	fail(`Unable to inspect the regenerated WASM package: ${statusResult.error.message}`);
}
if (statusResult.status !== 0) {
	fail(statusResult.stderr.trim() || "Unable to inspect the regenerated WASM package.");
}
if (statusResult.stdout.trim()) {
	console.error("The committed WASM package is stale. Run npm run build:wasm and commit:");
	console.error(statusResult.stdout.trim());
	process.exit(1);
}

console.log("The committed WASM package matches the pinned toolchain output.");
