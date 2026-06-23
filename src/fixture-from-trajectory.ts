/**
 * Crystallization primitive. Converts a recorded trajectory (an explorer's
 * run, or a Saga run's own trajectory dump) into a runnable `.saga.yaml`
 * skeleton: `event` entries become events, `effect` entries become that
 * event's `expected_effects`. This is the bridge that lets a live explorer
 * (gstack /qa, Playwright, Arga, a custom agent) hand a discovered journey
 * to Saga as a permanent deterministic fixture.
 */

import { stringify } from "yaml";
import type { TrajectoryEntry, TrajectoryHeader } from "./trajectory.js";

export interface TrajectorySnapshot {
	header: TrajectoryHeader;
	entries: TrajectoryEntry[];
}

export interface FixtureFromTrajectoryOptions {
	/** `duration_days` written to the manifest. Default 1. */
	durationDays?: number;
	/**
	 * ISO base timestamp used to synthesize event `at` values when the
	 * recorded payload has none. Each successive event is +1s. Default
	 * `2026-01-01T00:00:00.000Z`.
	 */
	baseTimestamp?: string;
}

export function fixtureFromTrajectory(
	snapshot: TrajectorySnapshot,
	options: FixtureFromTrajectoryOptions = {},
): string {
	const base = Date.parse(
		options.baseTimestamp ?? "2026-01-01T00:00:00.000Z",
	);
	const order: number[] = [];
	const events = new Map<
		number,
		{ kind: string; payload: Record<string, unknown> }
	>();
	const effects = new Map<
		number,
		Array<{ effect: string } & Record<string, unknown>>
	>();

	for (const e of snapshot.entries) {
		if (e.type === "event") {
			if (!events.has(e.event_index)) order.push(e.event_index);
			events.set(e.event_index, { kind: e.event_kind, payload: e.payload });
		} else if (e.type === "effect") {
			const arr = effects.get(e.event_index) ?? [];
			arr.push({ effect: e.effect_kind, ...e.payload });
			effects.set(e.event_index, arr);
		}
	}

	const manifestEvents = order.map((idx, i) => {
		const ev = events.get(idx) as {
			kind: string;
			payload: Record<string, unknown>;
		};
		const { at: payloadAt, ...rest } = ev.payload as {
			at?: unknown;
		} & Record<string, unknown>;
		const at =
			typeof payloadAt === "string"
				? payloadAt
				: new Date(base + i * 1000).toISOString();
		const expected = effects.get(idx) ?? [];
		return {
			at,
			kind: ev.kind,
			...rest,
			...(expected.length ? { expected_effects: expected } : {}),
		};
	});

	return stringify({
		saga_id: snapshot.header.saga_id,
		harness_version: snapshot.header.harness_version,
		duration_days: options.durationDays ?? 1,
		events: manifestEvents,
	});
}

export function fixtureFromTrajectoryJsonl(
	jsonl: string,
	options: FixtureFromTrajectoryOptions = {},
): string {
	const lines = jsonl
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	let header: TrajectoryHeader | undefined;
	const entries: TrajectoryEntry[] = [];
	for (const line of lines) {
		const obj = JSON.parse(line) as { type: string } & Record<string, unknown>;
		if (obj.type === "header") {
			const { type: _t, ...rest } = obj;
			header = rest as unknown as TrajectoryHeader;
		} else {
			entries.push(obj as unknown as TrajectoryEntry);
		}
	}
	if (!header) {
		throw new Error("trajectory JSONL missing header line");
	}
	return fixtureFromTrajectory({ header, entries }, options);
}
