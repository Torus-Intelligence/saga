import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import {
	Cassette,
	cassetteKey,
	resolveCassetteMode,
} from "../cassette.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "saga-cassette-"));
}

// ---------------------------------------------------------------------------
// off mode
// ---------------------------------------------------------------------------

test("off mode: calls produce every time (counter increments)", async () => {
	const c = new Cassette({ mode: "off" });
	let counter = 0;
	const inc = () => ++counter;

	const r1 = await c.use("k", inc);
	const r2 = await c.use("k", inc);

	expect(r1).toBe(1);
	expect(r2).toBe(2);
	expect(counter).toBe(2);
	expect(c.size).toBe(0);
});

// ---------------------------------------------------------------------------
// record + save + load (replay)
// ---------------------------------------------------------------------------

test("record mode: stores value; save+load replays without calling produce", async () => {
	const dir = await makeTmpDir();
	const path = join(dir, "cassette.json");

	try {
		// Record
		const rec = new Cassette({ mode: "record", path });
		const result = await rec.use("greeting", () => "hello");
		expect(result).toBe("hello");
		expect(rec.size).toBe(1);

		rec.save();

		// Replay — produce must NOT be called
		const rep = Cassette.load(path);
		expect(rep.mode).toBe("replay");
		expect(rep.size).toBe(1);

		const replayed = await rep.use<string>("greeting", () => {
			throw new Error("produce should not be called in replay");
		});
		expect(replayed).toBe("hello");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// replay miss
// ---------------------------------------------------------------------------

test("replay mode: missing key throws /replay miss/", async () => {
	const dir = await makeTmpDir();
	const path = join(dir, "empty.json");

	try {
		// Create a cassette file with no entries
		const rec = new Cassette({ mode: "record", path });
		rec.save();

		const rep = Cassette.load(path);
		await expect(
			rep.use("nonexistent", () => "x"),
		).rejects.toThrow(/replay miss/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// resolveCassetteMode honours SAGA_CASSETTE_MODE
// ---------------------------------------------------------------------------

test("resolveCassetteMode reads SAGA_CASSETTE_MODE env var", () => {
	const original = process.env.SAGA_CASSETTE_MODE;
	try {
		process.env.SAGA_CASSETTE_MODE = "record";
		expect(resolveCassetteMode()).toBe("record");

		process.env.SAGA_CASSETTE_MODE = "replay";
		expect(resolveCassetteMode()).toBe("replay");

		process.env.SAGA_CASSETTE_MODE = "off";
		expect(resolveCassetteMode()).toBe("off");

		// Invalid value falls back to "off"
		process.env.SAGA_CASSETTE_MODE = "invalid";
		expect(resolveCassetteMode()).toBe("off");

		// Explicit arg overrides env
		process.env.SAGA_CASSETTE_MODE = "record";
		expect(resolveCassetteMode("replay")).toBe("replay");
	} finally {
		if (original === undefined) {
			delete process.env.SAGA_CASSETTE_MODE;
		} else {
			process.env.SAGA_CASSETTE_MODE = original;
		}
	}
});

// ---------------------------------------------------------------------------
// cassetteKey
// ---------------------------------------------------------------------------

test("cassetteKey: key-order independent for objects, order-sensitive for arrays", () => {
	expect(cassetteKey({ a: 1, b: 2 })).toBe(cassetteKey({ b: 2, a: 1 }));
	expect(cassetteKey({ a: 1, b: 2 })).not.toBe(cassetteKey({ a: 1, b: 3 }));

	// Arrays keep order
	expect(cassetteKey([1, 2])).not.toBe(cassetteKey([2, 1]));

	// Nested objects also sorted
	expect(cassetteKey({ x: { c: 3, d: 4 } })).toBe(
		cassetteKey({ x: { d: 4, c: 3 } }),
	);
});
