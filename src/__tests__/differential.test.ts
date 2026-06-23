import { describe, expect, it } from "bun:test";
import {
	SagaBaselineDivergedError,
	assertAgainstBaseline,
	diffTrajectories,
} from "../differential.js";
import type { TrajectorySnapshot } from "../fixture-from-trajectory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEADER = {
	saga_id: "test-saga",
	harness_version: 1,
	fixture_path: "test.yaml",
	started_at: "2026-01-01T00:00:00.000Z",
	seed: 0,
	commit_hash: "abc123",
};

function makeSnapshot(
	effects: Array<{ effect_kind: string; payload: Record<string, unknown> }>,
): TrajectorySnapshot {
	return {
		header: HEADER,
		entries: effects.map((eff, i) => ({
			type: "effect" as const,
			event_index: i,
			effect_kind: eff.effect_kind,
			payload: eff.payload,
		})),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("diffTrajectories", () => {
	it("identical effect streams → matches true, differences empty", () => {
		const snap = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com", subject: "Hi" } },
			{ effect_kind: "record_created", payload: { name: "Alice", role: "admin" } },
		]);

		const result = diffTrajectories(snap, snap);

		expect(result.matches).toBe(true);
		expect(result.differences).toHaveLength(0);
	});

	it("non-volatile payload value change → matches false, one 'changed' difference", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com", subject: "Hello" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com", subject: "CHANGED" } },
		]);

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(false);
		expect(result.differences).toHaveLength(1);
		expect(result.differences[0].kind).toBe("changed");
		expect(result.differences[0].effect_kind).toBe("email_sent");
		expect(result.differences[0].position).toBe(0);
	});

	it("change only in a volatile field (id) → still matches true", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "record_created", payload: { id: "uuid-aaa", name: "Alice" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "record_created", payload: { id: "uuid-bbb", name: "Alice" } },
		]);

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(true);
		expect(result.differences).toHaveLength(0);
	});

	it("volatile field change in nested object → still matches true", () => {
		const baseline = makeSnapshot([
			{
				effect_kind: "task_scheduled",
				payload: {
					task: { id: "old-id", name: "send-report", timestamp: "2026-01-01T00:00:00Z" },
				},
			},
		]);
		const actual = makeSnapshot([
			{
				effect_kind: "task_scheduled",
				payload: {
					task: { id: "new-id", name: "send-report", timestamp: "2026-06-01T12:00:00Z" },
				},
			},
		]);

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(true);
		expect(result.differences).toHaveLength(0);
	});

	it("actual missing an effect the baseline has → 'missing' difference", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com" } },
			{ effect_kind: "record_created", payload: { name: "Alice" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com" } },
			// record_created is absent
		]);

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(false);
		expect(result.differences).toHaveLength(1);
		expect(result.differences[0].kind).toBe("missing");
		expect(result.differences[0].effect_kind).toBe("record_created");
		expect(result.differences[0].position).toBe(1);
		expect(result.differences[0].actual).toBeUndefined();
		expect(result.differences[0].baseline).toBeDefined();
	});

	it("actual having an extra effect → 'unexpected' difference", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com" } },
			{ effect_kind: "webhook_fired", payload: { url: "https://example.com/hook" } },
		]);

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(false);
		expect(result.differences).toHaveLength(1);
		expect(result.differences[0].kind).toBe("unexpected");
		expect(result.differences[0].effect_kind).toBe("webhook_fired");
		expect(result.differences[0].position).toBe(1);
		expect(result.differences[0].baseline).toBeUndefined();
		expect(result.differences[0].actual).toBeDefined();
	});

	it("effect_kind change at the same position → 'changed' difference", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "sms_sent", payload: { to: "alice@example.com" } },
		]);

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(false);
		expect(result.differences).toHaveLength(1);
		expect(result.differences[0].kind).toBe("changed");
		// effect_kind on the difference should reflect baseline's kind
		expect(result.differences[0].effect_kind).toBe("email_sent");
		expect(result.differences[0].detail).toMatch(/changed from/);
	});

	it("non-effect entries (events, assertion_failures) are ignored", () => {
		const baseline: TrajectorySnapshot = {
			header: HEADER,
			entries: [
				{
					type: "event",
					event_index: 0,
					event_kind: "user_signed_up",
					payload: { email: "alice@example.com" },
				},
				{
					type: "effect",
					event_index: 0,
					effect_kind: "record_created",
					payload: { name: "Alice" },
				},
				{
					type: "assertion_failure",
					event_index: 0,
					expected: "x",
					actual: "y",
					mismatch_reason: "not equal",
				},
			],
		};
		// Actual has same effect, different event payload (should not matter)
		const actual: TrajectorySnapshot = {
			header: HEADER,
			entries: [
				{
					type: "event",
					event_index: 0,
					event_kind: "user_signed_up",
					payload: { email: "DIFFERENT@example.com" },
				},
				{
					type: "effect",
					event_index: 0,
					effect_kind: "record_created",
					payload: { name: "Alice" },
				},
			],
		};

		const result = diffTrajectories(baseline, actual);

		expect(result.matches).toBe(true);
	});

	it("custom ignoreFields respected", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "order_placed", payload: { order_ref: "REF-001", total: 42 } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "order_placed", payload: { order_ref: "REF-999", total: 42 } },
		]);

		// Without custom ignore → should differ (order_ref is not in DEFAULT_VOLATILE_FIELDS)
		const resultWithoutCustom = diffTrajectories(baseline, actual);
		expect(resultWithoutCustom.matches).toBe(false);

		// With order_ref ignored → should match
		const resultWithCustom = diffTrajectories(baseline, actual, {
			ignoreFields: ["order_ref"],
		});
		expect(resultWithCustom.matches).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// assertAgainstBaseline
// ---------------------------------------------------------------------------

describe("assertAgainstBaseline", () => {
	it("does NOT throw when trajectories are identical", () => {
		const snap = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com" } },
		]);

		expect(() => assertAgainstBaseline(snap, snap)).not.toThrow();
	});

	it("throws SagaBaselineDivergedError on divergence", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com", subject: "Hello" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "email_sent", payload: { to: "alice@example.com", subject: "Bye" } },
		]);

		expect(() => assertAgainstBaseline(actual, baseline)).toThrow(
			SagaBaselineDivergedError,
		);
	});

	it("SagaBaselineDivergedError carries the DiffResult", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { subject: "Hello" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "email_sent", payload: { subject: "Bye" } },
		]);

		let caught: SagaBaselineDivergedError | undefined;
		try {
			assertAgainstBaseline(actual, baseline);
		} catch (err) {
			if (err instanceof SagaBaselineDivergedError) caught = err;
		}

		expect(caught).toBeDefined();
		expect(caught?.result.matches).toBe(false);
		expect(caught?.result.differences).toHaveLength(1);
	});

	it("SagaBaselineDivergedError message lists differences in human-readable form", () => {
		const baseline = makeSnapshot([
			{ effect_kind: "email_sent", payload: { subject: "Hello" } },
			{ effect_kind: "record_created", payload: { name: "Alice" } },
		]);
		const actual = makeSnapshot([
			{ effect_kind: "email_sent", payload: { subject: "Bye" } },
		]);

		let caught: SagaBaselineDivergedError | undefined;
		try {
			assertAgainstBaseline(actual, baseline);
		} catch (err) {
			if (err instanceof SagaBaselineDivergedError) caught = err;
		}

		expect(caught?.message).toContain("2 difference(s)");
		expect(caught?.message).toContain("email_sent");
		expect(caught?.message).toContain("record_created");
	});

	it("does NOT throw when only volatile fields differ", () => {
		const baseline = makeSnapshot([
			{
				effect_kind: "record_created",
				payload: { id: "old-id", timestamp: "2026-01-01T00:00:00Z", name: "Alice" },
			},
		]);
		const actual = makeSnapshot([
			{
				effect_kind: "record_created",
				payload: { id: "new-id", timestamp: "2026-06-01T12:00:00Z", name: "Alice" },
			},
		]);

		expect(() => assertAgainstBaseline(actual, baseline)).not.toThrow();
	});
});
