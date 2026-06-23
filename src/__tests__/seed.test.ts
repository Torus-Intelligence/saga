import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { z } from "zod";
import {
	BaseSagaEventSchema,
	BaseSagaManifestSchema,
	runSagaCore,
	resolveSeed,
	TrajectoryRecorder,
} from "../index.js";

test("resolveSeed honors an explicit seed", () => {
	expect(resolveSeed(42)).toBe(42);
});

test("resolveSeed honors the SAGA_SEED env var", () => {
	const original = process.env.SAGA_SEED;
	process.env.SAGA_SEED = "9001";
	try {
		expect(resolveSeed()).toBe(9001);
	} finally {
		if (original === undefined) delete process.env.SAGA_SEED;
		else process.env.SAGA_SEED = original;
	}
});

test("resolveSeed returns a finite integer by default (not hardcoded 0)", () => {
	const original = process.env.SAGA_SEED;
	delete process.env.SAGA_SEED;
	try {
		const s = resolveSeed();
		expect(Number.isInteger(s)).toBe(true);
		expect(s).toBeGreaterThanOrEqual(0);
	} finally {
		if (original !== undefined) process.env.SAGA_SEED = original;
	}
});

test("TrajectoryRecorder records the explicit seed in its header", () => {
	const rec = new TrajectoryRecorder({
		saga_id: "seed-arc",
		fixture_path: "n/a",
		seed: 12345,
	});
	expect(rec.seed).toBe(12345);
	expect(rec.snapshot().header.seed).toBe(12345);
});

const Event = BaseSagaEventSchema.extend({ kind: z.enum(["noop"]) }).passthrough();
const Manifest = BaseSagaManifestSchema.extend({
	events: z.array(Event).min(1),
});

async function writeNoopFixture(): Promise<{ dir: string; fixture: string }> {
	const dir = await mkdtemp(join(tmpdir(), "saga-seed-"));
	const fixture = join(dir, "noop.saga.yaml");
	await writeFile(
		fixture,
		"saga_id: seed-arc\nharness_version: 1\nduration_days: 1\nevents:\n  - at: 2026-06-01T09:00:00Z\n    kind: noop\n",
	);
	return { dir, fixture };
}

test("runSagaCore passes opts.seed through to dispatch and records it", async () => {
	const { dir, fixture } = await writeNoopFixture();
	let seenSeed: number | undefined;
	await runSagaCore(
		fixture,
		{
			manifestSchema: Manifest,
			dispatch: async (a) => {
				seenSeed = a.seed;
				return { observations: [] };
			},
		},
		{ seed: 777, trajectoryDir: dir },
	);
	expect(seenSeed).toBe(777);
});

test("runSagaCore uses the seed of an injected trajectory recorder", async () => {
	const { dir, fixture } = await writeNoopFixture();
	const traj = new TrajectoryRecorder({
		saga_id: "seed-arc",
		fixture_path: fixture,
		seed: 555,
	});
	let seenSeed: number | undefined;
	await runSagaCore(
		fixture,
		{
			manifestSchema: Manifest,
			dispatch: async (a) => {
				seenSeed = a.seed;
				return { observations: [] };
			},
		},
		{ trajectory: traj, trajectoryDir: dir },
	);
	expect(seenSeed).toBe(555);
	expect(traj.seed).toBe(555);
});
