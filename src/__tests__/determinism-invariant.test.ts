import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { z } from "zod";
import {
	BaseSagaEventSchema,
	BaseSagaManifestSchema,
	runSagaCore,
} from "../index.js";

const Event = BaseSagaEventSchema.extend({
	kind: z.enum(["noop"]),
}).passthrough();
const Manifest = BaseSagaManifestSchema.extend({
	events: z.array(Event).min(1),
});

test("default runSagaCore makes zero network calls", async () => {
	const dir = await mkdtemp(join(tmpdir(), "saga-invariant-"));
	const fixture = join(dir, "noop.saga.yaml");
	await writeFile(
		fixture,
		`saga_id: noop-arc\nharness_version: 1\nduration_days: 1\nevents:\n  - at: 2026-06-01T09:00:00Z\n    kind: noop\n`,
	);

	const originalFetch = globalThis.fetch;
	let networkUsed = false;
	globalThis.fetch = (() => {
		networkUsed = true;
		throw new Error("network call in default lane");
	}) as unknown as typeof fetch;

	try {
		const result = await runSagaCore(
			fixture,
			{
				manifestSchema: Manifest,
				dispatch: async () => ({ observations: [] }),
			},
			{ trajectoryDir: dir },
		);
		expect(result.saga_id).toBe("noop-arc");
		expect(result.events_executed).toBe(1);
		expect(networkUsed).toBe(false);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
