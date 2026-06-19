/**
 * @torus/saga
 *
 * Generic scenario-based testing system. Hand-authored YAML manifests
 * describe events across days; the runner dispatches each event to a
 * domain-supplied handler, captures observed effects, and verifies them
 * against the manifest's expected_effects.
 *
 * Domains supply:
 *   - a zod manifest schema extending BaseSagaManifestSchema
 *   - a DispatchFn mapping event_kind -> handler
 *   - a MatcherRegistry registering match functions per effect kind
 *
 * The core ships the runner, recorder, trajectory, verifier, outcome
 * adapters (fail-stop, auto-PR, ticket, hybrid), and persona-evolution
 * primitives.
 */

export * from "./logger.js";
export {
	__setGitHubClientForTest,
	__setLlmDrafterForTest,
	buildBranchName,
	buildPullRequestBody,
	type CommitFileArgs,
	type CreateBranchArgs,
	type CreatePullRequestArgs,
	type CreatePullRequestResult,
	configureAutoPr,
	type GitHubClient,
	getGitHubClient,
	getLlmDrafter,
	type LlmDrafter,
	parseDrafterReply,
} from "./outcomes/auto-pr.js";
export { SagaAssertionFailedError } from "./outcomes/fail-stop.js";
export {
	autoPrAdapter,
	DefaultOutcomeDispatcher,
	failStopAdapter,
	hybridAdapter,
	ticketAdapter,
} from "./outcomes/index.js";
export {
	configureTicketProvider,
	type TicketProvider,
} from "./outcomes/ticket.js";
export { buildTicketBody, TICKET_LABELS } from "./outcomes/tickets/common.js";
export {
	__setGitHubIssuesClientForTest,
	configureGitHubIssues,
	type GitHubIssueCreateArgs,
	type GitHubIssueCreateResult,
	type GitHubIssuesClient,
	getGitHubIssuesClient,
	handleGitHubIssueFailure,
} from "./outcomes/tickets/github-issues.js";
export {
	__setJiraClientForTest,
	configureJira,
	getJiraClient,
	handleJiraFailure,
	type JiraClient,
	type JiraCreateIssueArgs,
	type JiraCreateIssueResult,
} from "./outcomes/tickets/jira.js";
export {
	__setLinearClientForTest,
	configureLinear,
	getLinearClient,
	handleLinearFailure,
	type LinearClient,
	type LinearCreateIssueArgs,
	type LinearCreateIssueResult,
} from "./outcomes/tickets/linear.js";
export * from "./recorder.js";
export * from "./runner.js";
export * from "./trajectory.js";
export * from "./types.js";
export * from "./verifier.js";
