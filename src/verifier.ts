/**
 * Verifier -- reconciles expected_effects against the recorded log.
 *
 * Generic: domains register a `MatchFn` per effect kind via `MatcherRegistry`.
 * If no matcher is registered, the verifier falls back to a permissive
 * shallow-payload match (every field on `expected` other than `effect`
 * must equal the same key on the observation's payload).
 *
 * Returns three buckets:
 *   - passed: expected and observed.
 *   - failed: expected and NOT observed.
 *   - surprises: observed but never claimed by any expected_effect.
 *
 * We don't throw; the runner aggregates and reports. The CLI / test layer
 * decides whether a saga's pass-rate is enough to call it green.
 */

import type {
	ExpectedMatch,
	ExpectedMiss,
	SagaEffectBase,
	SagaObservation,
	SurpriseObservation,
} from "./types";

export type MatchFn = (
	expected: SagaEffectBase,
	observation: SagaObservation,
) => boolean;

export class MatcherRegistry {
	private readonly matchers = new Map<string, MatchFn>();
	private readonly surpriseIgnore = new Set<string>();

	register(effectKind: string, fn: MatchFn): this {
		this.matchers.set(effectKind, fn);
		return this;
	}

	/** Effect kinds NOT treated as surprises when unclaimed. */
	ignoreSurprise(effectKind: string): this {
		this.surpriseIgnore.add(effectKind);
		return this;
	}

	getMatcher(effectKind: string): MatchFn | undefined {
		return this.matchers.get(effectKind);
	}

	isSurpriseIgnored(effectKind: string): boolean {
		return this.surpriseIgnore.has(effectKind);
	}
}

/**
 * Permissive default match. Every key on `expected` other than `effect`
 * must equal the same key on the observation's payload. Missing or
 * mismatched -> no match.
 */
export function defaultMatch(
	expected: SagaEffectBase,
	o: SagaObservation,
): boolean {
	if (o.effect !== expected.effect) return false;
	for (const [k, v] of Object.entries(expected)) {
		if (k === "effect") continue;
		if (v === undefined) continue;
		if (o.payload[k] !== v) return false;
	}
	return true;
}

/**
 * Helper for matcher arms that opt into the WebArena-style typed outcome
 * enum. Returns true when expected doesn't declare an effect_outcome OR
 * when it equals the observation's payload.effect_outcome.
 */
export function effectOutcomeMatches(
	expected: { effect_outcome?: string },
	o: SagaObservation,
): boolean {
	if (expected.effect_outcome === undefined) return true;
	return o.payload.effect_outcome === expected.effect_outcome;
}

interface VerifyInput {
	expected: Array<{ event_index: number; expected: SagaEffectBase }>;
	observations: SagaObservation[];
	matchers?: MatcherRegistry;
}

interface VerifyOutput {
	passed: ExpectedMatch[];
	failed: ExpectedMiss[];
	surprises: SurpriseObservation[];
}

export function verify(input: VerifyInput): VerifyOutput {
	const matchers = input.matchers ?? new MatcherRegistry();
	const passed: ExpectedMatch[] = [];
	const failed: ExpectedMiss[] = [];
	const claimedObsSeqs = new Set<number>();

	for (const exp of input.expected) {
		const match = findMatch(
			exp.expected,
			input.observations,
			claimedObsSeqs,
			matchers,
		);
		if (match) {
			passed.push({
				event_index: exp.event_index,
				expected: exp.expected,
				observation_seq: match.seq,
			});
			claimedObsSeqs.add(match.seq);
		} else {
			failed.push({
				event_index: exp.event_index,
				expected: exp.expected,
				reason: explainMiss(exp.expected, input.observations),
			});
		}
	}

	const surprises: SurpriseObservation[] = [];
	for (const o of input.observations) {
		if (claimedObsSeqs.has(o.seq)) continue;
		if (matchers.isSurpriseIgnored(o.effect)) continue;
		surprises.push({
			observation: o,
			reason: `observed ${o.effect} not claimed by any expected_effect`,
		});
	}

	return { passed, failed, surprises };
}

function findMatch(
	expected: SagaEffectBase,
	observations: SagaObservation[],
	claimed: Set<number>,
	matchers: MatcherRegistry,
): SagaObservation | undefined {
	const matcher = matchers.getMatcher(expected.effect) ?? defaultMatch;
	for (const o of observations) {
		if (claimed.has(o.seq)) continue;
		if (o.effect !== expected.effect) continue;
		if (matcher(expected, o)) return o;
	}
	return undefined;
}

function explainMiss(
	expected: SagaEffectBase,
	observations: SagaObservation[],
): string {
	const sameKind = observations.filter((o) => o.effect === expected.effect);
	if (sameKind.length === 0) {
		return `no ${expected.effect} observations recorded`;
	}
	return `${sameKind.length} ${expected.effect} observation(s) recorded but none matched the expected payload`;
}
