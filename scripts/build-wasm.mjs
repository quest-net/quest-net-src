import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const EXPECTED_WASM_PACK_VERSION = "wasm-pack 0.15.0";
const PINNED_RUST_TOOLCHAIN = "1.96.0";
const env = { ...process.env, RUSTUP_TOOLCHAIN: PINNED_RUST_TOOLCHAIN };

function fail(message) {
	console.error(message);
	process.exit(1);
}

const versionResult = spawnSync("wasm-pack", ["--version"], {
	encoding: "utf8",
});
if (versionResult.error) {
	fail(`Unable to run wasm-pack: ${versionResult.error.message}`);
}
if (versionResult.status !== 0) {
	fail(versionResult.stderr.trim() || "Unable to read the wasm-pack version.");
}
if (versionResult.stdout.trim() !== EXPECTED_WASM_PACK_VERSION) {
	fail(
		`Expected ${EXPECTED_WASM_PACK_VERSION}, received ${versionResult.stdout.trim()}.`
	);
}

const buildResult = spawnSync(
	"wasm-pack",
	["build", "wasm/voxel-mesher", "--target", "bundler", "--out-dir", "pkg", "--release"],
	{ env, stdio: "inherit" }
);
if (buildResult.error) {
	fail(`Unable to build the WASM package: ${buildResult.error.message}`);
}
if (buildResult.status !== 0) {
	process.exit(buildResult.status ?? 1);
}

rmSync("wasm/voxel-mesher/pkg/.gitignore", { force: true });
