/**
 * Ticket outcome adapter. Reads SAGA_TICKET_PROVIDER and routes to the
 * matching sub-adapter (Linear, Jira, or GitHub Issues). No fall-back: if
 * the env is unset, the adapter returns noop so the runner logs why
 * nothing was filed.
 */

import type { SagaOutcomeAdapter, SagaOutcomeContext } from "../types.js";
import { handleGitHubIssueFailure } from "./tickets/github-issues.js";
import { handleJiraFailure } from "./tickets/jira.js";
import { handleLinearFailure } from "./tickets/linear.js";

export type TicketProvider = "linear" | "jira" | "github_issues";

let runtimeProvider: TicketProvider | undefined;

export function configureTicketProvider(provider: TicketProvider): void {
	runtimeProvider = provider;
}

export const ticketAdapter: SagaOutcomeAdapter = {
	name: "ticket",
	async handleFailure(ctx: SagaOutcomeContext) {
		const provider =
			(process.env.SAGA_TICKET_PROVIDER as TicketProvider | undefined) ??
			runtimeProvider;
		switch (provider) {
			case "linear":
				return handleLinearFailure(ctx);
			case "jira":
				return handleJiraFailure(ctx);
			case "github_issues":
				return handleGitHubIssueFailure(ctx);
			default:
				return {
					kind: "noop",
					reason:
						"ticket adapter requires SAGA_TICKET_PROVIDER to select a sub-adapter",
				};
		}
	},
};
