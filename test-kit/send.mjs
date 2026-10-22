// Send code to a running `node test-kit/run.mjs --serve`.
//   node test-kit/send.mjs "return kit.dm.state(c => c.Name)"
//   node test-kit/send.mjs -f some-snippet.js
import { readFile } from "node:fs/promises";

const [first, second] = process.argv.slice(2);
const code = first === "-f" ? await readFile(second, "utf8") : first;
const res = await fetch("http://127.0.0.1:3199/run", { method: "POST", body: code });
const text = await res.text();
console.log(text);
process.exit(res.ok ? 0 : 1);
