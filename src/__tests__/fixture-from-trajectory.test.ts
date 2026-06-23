import { expect, test } from "bun:test";
import { parse } from "yaml";
import {
	fixtureFromTrajectory,
	fixtureFromTrajectoryJsonl,
} from "../fixture-from-trajectory.js";

const header = {
	saga_id: "recorded-arc",
	harness_version: 1,
	fixture_path: "n/a",
	started_at: "2026-06-01T00:00:00.000Z",
	seed: 0,
	commit_hash: "",
};

test("fixtureFromTrajectory turns events+effects into a runnable manifest", () => {
	const yaml = fixtureFromTrajectory({
		header,
		entries: [
			{
				type: "event",
				event_index: 0,
				event_kind: "customer_files_ticket",
				payload: { at: "2026-06-01T09:00:00Z", subject: "Cannot export" },
			},
			{
				type: "effect",
				event_index: 0,
				effect_kind: "TicketCreated",
				payload: { id: "T-1", subject: "Cannot export" },
			},
		],
	});
	const m = parse(yaml);
	expect(m.saga_id).toBe("recorded-arc");
	expect(m.harness_version).toBe(1);
	expect(m.duration_days).toBe(1);
	expect(m.events).toHaveLength(1);
	expect(m.events[0].at).toBe("2026-06-01T09:00:00Z");
	expect(m.events[0].kind).toBe("customer_files_ticket");
	expect(m.events[0].subject).toBe("Cannot export");
	expect(m.events[0].expected_effects[0].effect).toBe("TicketCreated");
	expect(m.events[0].expected_effects[0].id).toBe("T-1");
});

test("synthesizes deterministic timestamps when payload has no `at`", () => {
	const yaml = fixtureFromTrajectory(
		{
			header,
			entries: [
				{ type: "event", event_index: 0, event_kind: "k", payload: {} },
				{ type: "event", event_index: 1, event_kind: "k", payload: {} },
			],
		},
		{ baseTimestamp: "2026-01-01T00:00:00.000Z" },
	);
	const m = parse(yaml);
	expect(m.events[0].at).toBe("2026-01-01T00:00:00.000Z");
	expect(m.events[1].at).toBe("2026-01-01T00:00:01.000Z");
});

test("fixtureFromTrajectoryJsonl parses dumped trajectory format", () => {
	const jsonl = [
		JSON.stringify({ type: "header", ...header }),
		JSON.stringify({
			type: "event",
			event_index: 0,
			event_kind: "k",
			payload: { at: "2026-06-01T09:00:00Z" },
		}),
		JSON.stringify({
			type: "effect",
			event_index: 0,
			effect_kind: "Done",
			payload: {},
		}),
	].join("\n");
	const m = parse(fixtureFromTrajectoryJsonl(jsonl));
	expect(m.events[0].expected_effects[0].effect).toBe("Done");
});

test("fixtureFromTrajectoryJsonl throws on missing header", () => {
	expect(() => fixtureFromTrajectoryJsonl("{}")).toThrow("missing header");
});
