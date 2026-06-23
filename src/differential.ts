/**
 * Production-baseline differential oracle. Compares the EFFECT stream
 * (outputs) of two trajectories, ignoring volatile fields such as IDs,
 * timestamps, and seeds so that noise-free semantic regressions surface.
 */

import type { TrajectorySnapshot } from "./fixture-from-trajectory.js";

export const DEFAULT_VOLATILE_FIELDS = [
	"id",
	"timestamp",
	"started_at",
	"commit_hash",
	"seed",
	"nonce",
	"at",
	"created_at",
	"updated_at",
];

export interface DiffOptions {
	ignoreFields?: string[];
}

export interface TrajectoryDifference {
	position: number;
	kind: "missing" | "unexpected" | "changed";
	effect_kind: string;
	detail: string;
	baseline?: unknown;
	actual?: unknown;
}

export interface DiffResult {
	matches: boolean;
	differences: TrajectoryDifference[];
}

export class SagaBaselineDivergedError extends Error {
	readonly result: DiffResult;

	constructor(result: DiffResult) {
		const lines: string[] = [
			`Saga baseline diverged: ${result.differences.length} difference(s) found.`,
		];
		for (const diff of result.differences) {
			lines.push(
				`  [${diff.position}] ${diff.kind.toUpperCase()} effect_kind="${diff.effect_kind}": ${diff.detail}`,
			);
			if (diff.baseline !== undefined) {
				lines.push(`    baseline: ${JSON.stringify(diff.baseline)}`);
			}
			if (diff.actual !== undefined) {
				lines.push(`    actual:   ${JSON.stringify(diff.actual)}`);
			}
		}
		super(lines.join("\n"));
		this.name = "SagaBaselineDivergedError";
		this.result = result;
	}
}

function normalize(
	payload: unknown,
	ignore: Set<string>,
): unknown {
	if (Array.isArray(payload)) {
		return payload.map((item) => normalize(item, ignore));
	}
	if (payload !== null && typeof payload === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(
			payload as Record<string, unknown>,
		)) {
			if (ignore.has(key)) continue;
			out[key] = normalize(value, ignore);
		}
		return out;
	}
	return payload;
}

export function diffTrajectories(
	baseline: TrajectorySnapshot,
	actual: TrajectorySnapshot,
	opts: DiffOptions = {},
): DiffResult {
	const ignore = new Set(opts.ignoreFields ?? DEFAULT_VOLATILE_FIELDS);

	const baselineEffects = baseline.entries
		.filter((e) => e.type === "effect")
		.map((e) => {
			// TypeScript narrowing — the filter guarantees type === "effect"
			const eff = e as Extract<typeof e, { type: "effect" }>;
			return { effect_kind: eff.effect_kind, payload: eff.payload };
		});

	const actualEffects = actual.entries
		.filter((e) => e.type === "effect")
		.map((e) => {
			const eff = e as Extract<typeof e, { type: "effect" }>;
			return { effect_kind: eff.effect_kind, payload: eff.payload };
		});

	const differences: TrajectoryDifference[] = [];
	const len = Math.max(baselineEffects.length, actualEffects.length);

	for (let i = 0; i < len; i++) {
		const b = baselineEffects[i];
		const a = actualEffects[i];

		if (b !== undefined && a === undefined) {
			differences.push({
				position: i,
				kind: "missing",
				effect_kind: b.effect_kind,
				detail: `Expected effect "${b.effect_kind}" at position ${i} but actual trajectory ended.`,
				baseline: normalize(b.payload, ignore),
			});
		} else if (b === undefined && a !== undefined) {
			differences.push({
				position: i,
				kind: "unexpected",
				effect_kind: a.effect_kind,
				detail: `Unexpected effect "${a.effect_kind}" at position ${i} not present in baseline.`,
				actual: normalize(a.payload, ignore),
			});
		} else if (b !== undefined && a !== undefined) {
			const normBaseline = normalize(b.payload, ignore);
			const normActual = normalize(a.payload, ignore);
			const kindDiffers = b.effect_kind !== a.effect_kind;
			const payloadDiffers =
				JSON.stringify(normBaseline) !== JSON.stringify(normActual);

			if (kindDiffers || payloadDiffers) {
				differences.push({
					position: i,
					kind: "changed",
					effect_kind: b.effect_kind,
					detail: kindDiffers
						? `effect_kind changed from "${b.effect_kind}" to "${a.effect_kind}".`
						: `Payload content changed for effect "${b.effect_kind}".`,
					baseline: normBaseline,
					actual: normActual,
				});
			}
		}
	}

	return {
		matches: differences.length === 0,
		differences,
	};
}

export function assertAgainstBaseline(
	actual: TrajectorySnapshot,
	baseline: TrajectorySnapshot,
	opts: DiffOptions = {},
): void {
	const result = diffTrajectories(baseline, actual, opts);
	if (!result.matches) {
		throw new SagaBaselineDivergedError(result);
	}
}
