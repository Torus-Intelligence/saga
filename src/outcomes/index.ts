/**
 * Pluggable outcome adapters. The saga runner calls
 * `dispatchOutcome()` after the verifier returns a non-empty failed list.
 * The dispatcher resolves an adapter (built-in fail-stop / auto-PR /
 * ticket / hybrid, or a DI-injected custom one) and hands it a structured
 * `SagaOutcomeContext`. Adapters return a `SagaOutcomeResult` describing
 * what happened so the runner can log it.
 *
 * Adapter dispatch is opt-in. Pass an `OutcomeDispatcher` to the runner
 * when you want failures routed.
 */

import { namedLogger } from "../logger.js";
import type {
	AssertionFailure,
	BaseSagaManifest,
	SagaOutcomeAdapter,
	SagaOutcomeContext,
	SagaOutcomeResult,
	SagaRunResult,
} from "../types.js";
import { autoPrAdapter } from "./auto-pr.js";
import { failStopAdapter } from "./fail-stop.js";
import { hybridAdapter } from "./hybrid.js";
import { ticketAdapter } from "./ticket.js";

const log = namedLogger("@torus/saga:outcomes");

export type AdapterName = "fail_stop" | "auto_pr" | "ticket" | "hybrid";

export class DefaultOutcomeDispatcher {
	private testAdapter: SagaOutcomeAdapter | null = null;
	private envAdapter: AdapterName | null = null;

	__setOutcomeAdapterForTest(adapter: SagaOutcomeAdapter | null): void {
		this.testAdapter = adapter;
	}

	configureAdapter(name: AdapterName | null): void {
		this.envAdapter = name;
	}

	resolveAdapter(): SagaOutcomeAdapter | null {
		if (this.testAdapter) return this.testAdapter;
		const name =
			(process.env.SAGA_OUTCOME_ADAPTER as AdapterName | undefined) ??
			this.envAdapter ??
			null;
		switch (name) {
			case "fail_stop":
				return failStopAdapter;
			case "auto_pr":
				return autoPrAdapter;
			case "ticket":
				return ticketAdapter;
			case "hybrid":
				return hybridAdapter;
			default:
				return null;
		}
	}

	async dispatch(args: {
		manifest: BaseSagaManifest;
		fixturePath: string;
		harnessVersion: number;
		verdict: SagaRunResult;
		trajectoryPath: string | null;
		commitHash: string | null;
	}): Promise<SagaOutcomeResult | null> {
		const adapter = this.resolveAdapter();
		if (!adapter) return null;
		if (args.verdict.failed.length === 0) return null;

		const firstMiss = args.verdict.failed[0];
		const failure: AssertionFailure = {
			saga_id: args.manifest.saga_id,
			event_index: firstMiss.event_index,
			expected: firstMiss.expected,
			reason: firstMiss.reason,
			miss_count: args.verdict.failed.length,
			surprise_count: args.verdict.surprises.length,
		};

		const emittedKinds = Array.from(
			new Set(args.verdict.full_log.map((o) => o.effect)),
		);

		const ctx: SagaOutcomeContext = {
			saga_id: args.manifest.saga_id,
			fixture_path: args.fixturePath,
			harness_version: args.harnessVersion,
			trajectory_path: args.trajectoryPath,
			failure,
			fixture: args.manifest,
			emitted_effects: emittedKinds,
			commit_hash: args.commitHash,
		};

		log.info(
			`dispatching saga failure to outcome adapter "${adapter.name}" (saga=${args.manifest.saga_id})`,
		);

		const result = await adapter.handleFailure(ctx);

		switch (result.kind) {
			case "pr_drafted":
				log.info(
					`outcome adapter "${adapter.name}" drafted PR ${result.pr_url}`,
				);
				break;
			case "ticket_filed":
				log.info(
					`outcome adapter "${adapter.name}" filed ticket ${result.ticket_url}`,
				);
				break;
			case "noop":
				log.info(
					`outcome adapter "${adapter.name}" returned noop: ${result.reason}`,
				);
				break;
			case "fail_stop":
				break;
		}

		return result;
	}
}

export { autoPrAdapter, failStopAdapter, hybridAdapter, ticketAdapter };
