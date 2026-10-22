// Minimal in-memory Nostr relay for the test kit. Speaks just enough of NIP-01
// for Trystero's signaling: EVENT -> OK + fan-out to matching live REQs.
// No storage, no signature checks (Trystero subscribes with since=now anyway).
//
// Standalone: node test-kit/relay.mjs [port]
import { WebSocketServer } from "ws";

function matches(filter, event) {
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
	for (const [key, values] of Object.entries(filter)) {
		if (!key.startsWith("#")) continue;
		const name = key.slice(1);
		if (!event.tags?.some((t) => t[0] === name && values.includes(t[1]))) return false;
	}
	return true;
}

export function startRelay(port = 7777) {
	const wss = new WebSocketServer({ port });
	wss.on("connection", (socket) => {
		socket.subs = new Map(); // subId -> filters[]
		socket.on("message", (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			const [type, ...rest] = msg;
			if (type === "REQ") {
				const [subId, ...filters] = rest;
				socket.subs.set(subId, filters);
				socket.send(JSON.stringify(["EOSE", subId]));
			} else if (type === "CLOSE") {
				socket.subs.delete(rest[0]);
			} else if (type === "EVENT") {
				const event = rest[0];
				socket.send(JSON.stringify(["OK", event.id, true, ""]));
				for (const client of wss.clients) {
					if (client.readyState !== 1) continue;
					for (const [subId, filters] of client.subs) {
						if (filters.some((f) => matches(f, event))) {
							client.send(JSON.stringify(["EVENT", subId, event]));
						}
					}
				}
			}
		});
	});
	return new Promise((resolve, reject) => {
		wss.once("listening", () => resolve(wss));
		wss.once("error", reject);
	});
}

// Self-check: a subscriber receives a matching event and not a non-matching one.
export async function selfTest() {
	const { WebSocket } = await import("ws");
	const wss = await startRelay(0);
	const url = `ws://localhost:${wss.address().port}`;
	const a = new WebSocket(url);
	const b = new WebSocket(url);
	await Promise.all([a, b].map((s) => new Promise((r) => s.once("open", r))));
	const got = [];
	a.on("message", (m) => got.push(JSON.parse(m.toString())));
	a.send(JSON.stringify(["REQ", "s1", { kinds: [20001], "#x": ["topic"] }]));
	await new Promise((r) => setTimeout(r, 50));
	b.send(JSON.stringify(["EVENT", { id: "1", kind: 20001, tags: [["x", "topic"]], content: "hi" }]));
	b.send(JSON.stringify(["EVENT", { id: "2", kind: 20001, tags: [["x", "other"]], content: "no" }]));
	await new Promise((r) => setTimeout(r, 100));
	a.close();
	b.close();
	wss.close();
	const events = got.filter((m) => m[0] === "EVENT");
	if (events.length !== 1 || events[0][2].content !== "hi") {
		throw new Error(`relay self-test failed: ${JSON.stringify(got)}`);
	}
	console.log("relay self-test ok");
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
	if (process.argv[2] === "--self-test") await selfTest();
	else {
		const port = Number(process.argv[2] ?? 7777);
		await startRelay(port);
		console.log(`nostr relay on ws://localhost:${port}`);
	}
}
