/**
 * Generic saga types. The runner walks a manifest, dispatches each event
 * into a per-event-kind handler, drains observed effects through the
 * recorder, and verifies against the manifest's expected effects.
 *
 * Domains extend these by:
 *   1. providing their own ExpectedEffectSchema (a zod discriminated union
 *      keyed by `effect`) and SagaEventSchema (any zod object with an `at`
 *      string plus a `kind` discriminator),
 *   2. registering a dispatcher (event_kind -> handler),
 *   3. registering a matcher per effect kind on the verifier.
 *
 * The base shapes here describe the contract every domain must satisfy.
 */

import { z } from "zod";

/**
 * WebArena-style typed outcome enum. Carried by selected effect kinds so
 * assertions can distinguish "agent didn't act" from "agent did the wrong
 * thing" from "the system blocked it". Domains opt their effects into this
 * by adding `effect_outcome: SagaEffectOutcomeSchema.optional()` on the
 * matching arm.
 */
export type SagaEffectOutcome =
	| "SUCCESS"
	| "NOT_FOUND"
	| "PERMISSION_DENIED"
	| "DATA_VALIDATION_ERROR"
	| "RATE_LIMITED";

export const SagaEffectOutcomeSchema = z.enum([
	"SUCCESS",
	"NOT_FOUND",
	"PERMISSION_DENIED",
	"DATA_VALIDATION_ERROR",
	"RATE_LIMITED",
]);

/**
 * Generic shape every effect must satisfy: an `effect` discriminator
 * (string) plus any number of optional fields. Domains usually declare a
 * `z.discriminatedUnion("effect", [...])`; the runner / verifier only need
 * the `effect` field at the generic level.
 */
export interface SagaEffectBase {
	effect: string;
	[key: string]: unknown;
}

/**
 * Base saga event shape. Carries `at` (ISO timestamp) and `kind` (event
 * discriminator). Domains extend by intersecting a `z.object({...})` with
 * arbitrary domain payload fields.
 */
export const BaseSagaEventSchema = z
	.object({
		at: z.string(),
		kind: z.string(),
		actor: z.string().optional(),
		project_id: z.string().optional(),
		expected_effects: z.array(z.any()).optional(),
		/**
		 * Tavern-style save: directive. Selector grammar is
		 * `effects.<effect_kind>[<index>].<field>`. Captured values land on
		 * a SagaState bag; later events reference them via
		 * `{{saved.<name>}}` substitution.
		 */
		save: z.record(z.string(), z.string()).optional(),
	})
	.passthrough();

export type BaseSagaEvent = z.infer<typeof BaseSagaEventSchema>;

/**
 * Base manifest shape. Domains may extend `firm`, `cast`, etc., but the
 * runner only relies on `saga_id`, `harness_version`, `duration_days`, and
 * `events`. Severity is read by the hybrid outcome adapter.
 */
export const BaseSagaManifestSchema = z
	.object({
		saga_id: z.string().regex(/^[a-z0-9-]+$/),
		harness_version: z.number().int().positive().optional(),
		severity: z.enum(["critical", "warning", "info"]).optional(),
		duration_days: z.number().int().positive(),
		events: z.array(BaseSagaEventSchema).min(1),
	})
	.passthrough();

export type BaseSagaManifest = z.infer<typeof BaseSagaManifestSchema>;

/**
 * METR-style harness schema version. Stamped on every fixture so the
 * runner can refuse fixtures targeting a future schema. Bump when an
 * event_kind, expected_effect shape, or selector grammar changes in a way
 * that breaks older fixtures.
 */
export const CURRENT_HARNESS_VERSION = 1;

/**
 * SagaState carries values captured from earlier events via `save:` blocks.
 * Flat name -> value bag scoped to a single saga run.
 */
export type SagaState = Record<string, unknown>;

/**
 * One observed side effect. The recorder time-orders these so the verifier
 * can reconstruct what the system actually did for a given event.
 */
export interface SagaObservation {
	seq: number;
	event_index: number;
	effect: string;
	payload: Record<string, unknown>;
}

export interface ExpectedMatch {
	event_index: number;
	expected: SagaEffectBase;
	observation_seq: number;
}

export interface ExpectedMiss {
	event_index: number;
	expected: SagaEffectBase;
	reason: string;
}

export interface SurpriseObservation {
	observation: SagaObservation;
	reason: string;
}

export interface SagaRunResult {
	saga_id: string;
	events_executed: number;
	total_assertions: number;
	passed: ExpectedMatch[];
	failed: ExpectedMiss[];
	surprises: SurpriseObservation[];
	full_log: SagaObservation[];
}

/**
 * SyncLog is the per-injector return shape. Each injector calls into the
 * real surface it owns, captures pure observations, and returns them as
 * a SyncLog. The recorder folds these into the unified observation stream.
 */
export interface SyncLog {
	observations: Array<Omit<SagaObservation, "seq" | "event_index">>;
}

/**
 * Structured failure record handed to outcome adapters. Wraps the
 * verifier's first miss plus surrounding event context.
 */
export interface AssertionFailure {
	saga_id: string;
	event_index: number;
	expected: SagaEffectBase;
	reason: string;
	miss_count: number;
	surprise_count: number;
}

export interface SagaOutcomeContext {
	saga_id: string;
	fixture_path: string;
	harness_version: number;
	trajectory_path: string | null;
	failure: AssertionFailure;
	fixture: BaseSagaManifest;
	emitted_effects: string[];
	commit_hash: string | null;
}

export type SagaOutcomeResult =
	| { kind: "fail_stop" }
	| { kind: "pr_drafted"; pr_url: string; pr_number: number }
	| { kind: "ticket_filed"; ticket_url: string; ticket_id: string }
	| { kind: "noop"; reason: string };

export interface SagaOutcomeAdapter {
	name: string;
	handleFailure(ctx: SagaOutcomeContext): Promise<SagaOutcomeResult>;
}
