/**
 * Saga runner -- the top-level entry point. Parses a YAML manifest,
 * validates against the (domain-supplied) saga schema, replays each event
 * in chronological order, drains observed side effects through the
 * recorder, and verifies against expected_effects.
 *
 * Generic over:
 *   - manifestSchema: a zod schema that produces a `BaseSagaManifest`-
 *     compatible object (may extend with domain fields).
 *   - dispatch: a function that takes one event and returns a SyncLog.
 *   - matchers: an optional MatcherRegistry for the verifier.
 *
 * The runner is sync where possible. Where the dispatch is async, we await
 * each event before moving on so observation ordering remains deterministic.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import { namedLogger } from "./logger";
import { SagaRecorder } from "./recorder";
import { TrajectoryRecorder, trajectoryDumpEnabled } from "./trajectory";
import {
	type BaseSagaEvent,
	type BaseSagaManifest,
	CURRENT_HARNESS_VERSION,
	type SagaEffectBase,
	type SagaObservation,
	type SagaRunResult,
	type SagaState,
	type SyncLog,
} from "./types";
import { type MatcherRegistry, type MatchFn, verify } from "./verifier";

const log = namedLogger("runner");

export interface DispatchArgs<
	E extends BaseSagaEvent,
	M extends BaseSagaManifest,
> {
	event: E;
	manifest: M;
	fixturesRoot: string;
	projectId: string;
}

export type DispatchFn<E extends BaseSagaEvent, M extends BaseSagaManifest> = (
	args: DispatchArgs<E, M>,
) => Promise<SyncLog>;

export interface OutcomeDispatcher {
	resolveAdapter(): import("./types").SagaOutcomeAdapter | null;
	dispatch(args: {
		manifest: BaseSagaManifest;
		fixturePath: string;
		harnessVersion: number;
		verdict: SagaRunResult;
		trajectoryPath: string | null;
		commitHash: string | null;
	}): Promise<unknown>;
}

export interface RunSagaOpts<
	E extends BaseSagaEvent = BaseSagaEvent,
	M extends BaseSagaManifest = BaseSagaManifest,
> {
	recorder?: SagaRecorder;
	fixturesRoot?: string;
	trajectory?: TrajectoryRecorder;
	trajectoryDir?: string;
	/** Optional outcome dispatcher (fail-stop / auto-PR / ticket / hybrid). */
	outcomeDispatcher?: OutcomeDispatcher;
	/**
	 * Optional hook to derive project_id from the manifest. Defaults to the
	 * first event's `project_id` or `${saga_id}-project`.
	 */
	inferProjectId?: (manifest: M) => string;
	/**
	 * Optional hook to filter the event payload before recording into the
	 * trajectory. Default is a tight default-field copy.
	 */
	serializeEventForTrajectory?: (e: E) => Record<string, unknown>;
}

export interface RunnerConfig<
	E extends BaseSagaEvent,
	M extends BaseSagaManifest,
> {
	manifestSchema: z.ZodType<M>;
	dispatch: DispatchFn<E, M>;
	matchers?: MatcherRegistry;
	/** Optional pre-run env mutation hook (e.g. SIM_HARNESS_BYPASS_SVIX). */
	prepareEnv?: () => void;
}

export async function runSagaCore<
	E extends BaseSagaEvent,
	M extends BaseSagaManifest,
>(
	manifestPath: string,
	config: RunnerConfig<E, M>,
	opts: RunSagaOpts<E, M> = {},
): Promise<SagaRunResult> {
	config.prepareEnv?.();

	const recorder = opts.recorder ?? new SagaRecorder();
	const fixturesRoot = opts.fixturesRoot ?? dirname(resolve(manifestPath));
	const fixturesRootResolved = isAbsolute(fixturesRoot)
		? fixturesRoot
		: resolve(fixturesRoot);

	const yamlText = await readFile(manifestPath, "utf8");
	const raw = parse(yamlText);
	const manifest = config.manifestSchema.parse(raw);

	const fixtureVersion = manifest.harness_version ?? 1;
	if (fixtureVersion > CURRENT_HARNESS_VERSION) {
		throw new Error(
			`Saga harness_version ${fixtureVersion} is newer than this runner supports (max ${CURRENT_HARNESS_VERSION})`,
		);
	}

	log.info(
		`running saga "${manifest.saga_id}" (${manifest.events.length} events)`,
	);

	const trajectory =
		opts.trajectory ??
		new TrajectoryRecorder({
			saga_id: manifest.saga_id,
			fixture_path: manifestPath,
			harness_version: fixtureVersion,
		});

	const projectId = opts.inferProjectId
		? opts.inferProjectId(manifest)
		: defaultInferProjectId(manifest);

	const ordered = manifest.events
		.map((e, i) => ({ e: e as E, original_index: i }))
		.sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at));

	const expectedAll: Array<{
		event_index: number;
		expected: SagaEffectBase;
	}> = [];

	const sagaState: SagaState = {};
	const serialize = opts.serializeEventForTrajectory ?? defaultSerializeEvent;

	for (let i = 0; i < ordered.length; i++) {
		const { e, original_index } = ordered[i];
		recorder.beginEvent(original_index);

		const resolved = substituteSavedRefs(e, sagaState) as E;

		trajectory.record({
			type: "event",
			event_index: original_index,
			event_kind: resolved.kind,
			payload: serialize(resolved),
		});

		const sync = await config.dispatch({
			event: resolved,
			manifest,
			fixturesRoot: fixturesRootResolved,
			projectId,
		});

		recorder.ingest(sync);

		for (const obs of sync.observations) {
			trajectory.record({
				type: "effect",
				event_index: original_index,
				effect_kind: obs.effect,
				payload: obs.payload,
			});
		}

		applySaveDirective(resolved.save, sync, sagaState);

		for (const exp of resolved.expected_effects ?? []) {
			expectedAll.push({
				event_index: original_index,
				expected: exp as SagaEffectBase,
			});
		}
	}

	const observations = recorder.snapshot();
	const verdict = verify({
		expected: expectedAll,
		observations,
		matchers: config.matchers,
	});

	for (const miss of verdict.failed) {
		trajectory.record({
			type: "assertion_failure",
			event_index: miss.event_index,
			expected: miss.expected,
			actual: null,
			mismatch_reason: miss.reason,
		});
	}

	let trajectoryPath: string | null = null;
	if (verdict.failed.length > 0 && trajectoryDumpEnabled()) {
		const dir = opts.trajectoryDir ?? join(process.cwd(), "__trajectories__");
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		const outPath = join(dir, `${manifest.saga_id}-${ts}.jsonl`);
		try {
			trajectory.dump(outPath);
			trajectoryPath = outPath;
			log.warn(
				`saga "${manifest.saga_id}" failed verification; trajectory at ${outPath}`,
			);
		} catch (err) {
			log.warn(
				`saga "${manifest.saga_id}" trajectory dump failed: ${(err as Error).message}`,
			);
		}
	}

	const runResult: SagaRunResult = {
		saga_id: manifest.saga_id,
		events_executed: ordered.length,
		total_assertions: expectedAll.length,
		passed: verdict.passed,
		failed: verdict.failed,
		surprises: verdict.surprises,
		full_log: observations,
	};

	if (
		verdict.failed.length > 0 &&
		opts.outcomeDispatcher &&
		opts.outcomeDispatcher.resolveAdapter() !== null
	) {
		await opts.outcomeDispatcher.dispatch({
			manifest,
			fixturePath: manifestPath,
			harnessVersion: fixtureVersion,
			verdict: runResult,
			trajectoryPath,
			commitHash: trajectory.snapshot().header.commit_hash || null,
		});
	}

	return runResult;
}

function defaultInferProjectId<M extends BaseSagaManifest>(
	manifest: M,
): string {
	for (const e of manifest.events) {
		const pid = (e as BaseSagaEvent).project_id;
		if (pid) return pid;
	}
	return `${manifest.saga_id}-project`;
}

function defaultSerializeEvent<E extends BaseSagaEvent>(
	e: E,
): Record<string, unknown> {
	const out: Record<string, unknown> = { at: e.at };
	const passthrough = [
		"actor",
		"from",
		"to",
		"subject",
		"project_id",
		"filename",
		"path",
		"provider",
		"capability",
		"document_id",
		"event_type",
		"message",
	];
	for (const k of passthrough) {
		const v = (e as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	return out;
}

function substituteSavedRefs<E extends BaseSagaEvent>(
	event: E,
	state: SagaState,
): E {
	return walk(event, state) as E;
}

const SAVED_REF = /\{\{\s*saved\.([a-zA-Z0-9_]+)\s*\}\}/g;

function walk(value: unknown, state: SagaState): unknown {
	if (typeof value === "string") {
		const whole = value.match(/^\{\{\s*saved\.([a-zA-Z0-9_]+)\s*\}\}$/);
		if (whole) {
			const name = whole[1];
			if (!(name in state)) {
				throw new Error(
					`saga save: reference {{saved.${name}}} has no captured value (event payload)`,
				);
			}
			return state[name];
		}
		return value.replace(SAVED_REF, (_, name: string) => {
			if (!(name in state)) {
				throw new Error(
					`saga save: reference {{saved.${name}}} has no captured value (event payload)`,
				);
			}
			return String(state[name] ?? "");
		});
	}
	if (Array.isArray(value)) {
		return value.map((v) => walk(v, state));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = walk(v, state);
		}
		return out;
	}
	return value;
}

function applySaveDirective(
	save: Record<string, string> | undefined,
	sync: SyncLog,
	state: SagaState,
): void {
	if (!save) return;
	for (const [name, selector] of Object.entries(save)) {
		const value = evalSelector(selector, sync);
		if (value === undefined) {
			throw new Error(
				`saga save: selector "${selector}" for name "${name}" did not resolve against the event's emitted effects`,
			);
		}
		state[name] = value;
	}
}

const SELECTOR = /^effects\.([a-z_]+)\[(\d+)\]\.([a-zA-Z0-9_]+)$/;

function evalSelector(selector: string, sync: SyncLog): unknown {
	const m = selector.match(SELECTOR);
	if (!m) {
		throw new Error(
			`saga save: selector "${selector}" must match effects.<effect_kind>[<index>].<field>`,
		);
	}
	const [, kind, idxStr, field] = m;
	const idx = Number.parseInt(idxStr, 10);
	const matching = sync.observations.filter(
		(o: SyncLog["observations"][number]) => o.effect === kind,
	);
	const obs = matching[idx];
	if (!obs) return undefined;
	return (obs.payload as Record<string, unknown>)[field];
}

// Re-export observation type so consumers that only import the runner get
// the matching shape for free.
export type { SagaObservation };
