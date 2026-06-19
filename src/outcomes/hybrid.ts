/**
 * Hybrid outcome adapter. Reads the saga manifest's `severity` tag and
 * routes accordingly:
 *
 *   - critical -> ticket sub-adapter (Linear/Jira/GitHub by env)
 *   - warning  -> auto-PR adapter
 *   - info or unset -> fail-stop adapter
 */

import type { SagaOutcomeAdapter, SagaOutcomeContext } from "../types.js";
import { autoPrAdapter } from "./auto-pr.js";
import { failStopAdapter } from "./fail-stop.js";
import { ticketAdapter } from "./ticket.js";

export const hybridAdapter: SagaOutcomeAdapter = {
	name: "hybrid",
	async handleFailure(ctx: SagaOutcomeContext) {
		const severity = ctx.fixture.severity ?? "info";
		switch (severity) {
			case "critical":
				return ticketAdapter.handleFailure(ctx);
			case "warning":
				return autoPrAdapter.handleFailure(ctx);
			case "info":
				return failStopAdapter.handleFailure(ctx);
			default:
				return failStopAdapter.handleFailure(ctx);
		}
	},
};
