import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { TrajectoryRecorder } from "../trajectory.js";

test("TrajectoryRecorder.dump writes header-first JSONL", async () => {
	const dir = await mkdtemp(join(tmpdir(), "saga-traj-"));
	const rec = new TrajectoryRecorder({
		saga_id: "t-arc",
		fixture_path: "n/a",
	});
	rec.record({
		type: "event",
		event_index: 0,
		event_kind: "k",
		payload: { a: 1 },
	});
	const out = join(dir, "t.jsonl");
	rec.dump(out);

	const lines = readFileSync(out, "utf8").trim().split("\n");
	const head = JSON.parse(lines[0]);
	expect(head.type).toBe("header");
	expect(head.saga_id).toBe("t-arc");
	expect(head.harness_version).toBe(1);
	expect(JSON.parse(lines[1]).event_kind).toBe("k");
});

test("snapshot returns header plus a copy of entries", () => {
	const rec = new TrajectoryRecorder({ saga_id: "s-arc", fixture_path: "n/a" });
	rec.record({ type: "event", event_index: 0, event_kind: "k", payload: {} });
	const snap = rec.snapshot();
	expect(snap.header.saga_id).toBe("s-arc");
	expect(snap.entries).toHaveLength(1);
	snap.entries.push({
		type: "event",
		event_index: 9,
		event_kind: "x",
		payload: {},
	});
	expect(rec.entryCount).toBe(1); // snapshot copy did not mutate recorder
});
