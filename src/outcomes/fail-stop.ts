/**
 * Fail-stop outcome adapter. Wraps the verifier's first miss in an Error
 * and throws. Used when the caller wants the saga to surface as a red test
 * rather than just a non-empty `failed` list on the result.
 *
 * The error message includes the saga id, the expected effect kind, the
 * event index, and the verifier's miss reason so the test runner output
 * is enough to diagnose without opening the trajectory dump.
 */

import type { SagaOutcomeAdapter, SagaOutcomeContext } from "../types";

export class SagaAssertionFailedError extends Error {
	constructor(
		readonly saga_id: string,
		readonly event_index: number,
		readonly expected_kind: string,
		readonly reason: string,
		readonly trajectory_path: string | null,
	) {
		const tail = trajectory_path ? ` (trajectory at ${trajectory_path})` : "";
		super(
			`saga "${saga_id}" failed verification at event ${event_index}: expected ${expected_kind} not observed (${reason})${tail}`,
		);
		this.name = "SagaAssertionFailedError";
	}
}

export const failStopAdapter: SagaOutcomeAdapter = {
	name: "fail_stop",
	async handleFailure(ctx: SagaOutcomeContext) {
		throw new SagaAssertionFailedError(
			ctx.saga_id,
			ctx.failure.event_index,
			ctx.failure.expected.effect,
			ctx.failure.reason,
			ctx.trajectory_path,
		);
	},
};
