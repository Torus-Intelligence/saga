/**
 * saga-core
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

export * from "./logger";
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
} from "./outcomes/auto-pr";
export { SagaAssertionFailedError } from "./outcomes/fail-stop";
export {
	autoPrAdapter,
	DefaultOutcomeDispatcher,
	failStopAdapter,
	hybridAdapter,
	ticketAdapter,
} from "./outcomes/index";
export {
	configureTicketProvider,
	type TicketProvider,
} from "./outcomes/ticket";
export { buildTicketBody, TICKET_LABELS } from "./outcomes/tickets/common";
export {
	__setGitHubIssuesClientForTest,
	configureGitHubIssues,
	type GitHubIssueCreateArgs,
	type GitHubIssueCreateResult,
	type GitHubIssuesClient,
	getGitHubIssuesClient,
	handleGitHubIssueFailure,
} from "./outcomes/tickets/github-issues";
export {
	__setJiraClientForTest,
	configureJira,
	getJiraClient,
	handleJiraFailure,
	type JiraClient,
	type JiraCreateIssueArgs,
	type JiraCreateIssueResult,
} from "./outcomes/tickets/jira";
export {
	__setLinearClientForTest,
	configureLinear,
	getLinearClient,
	handleLinearFailure,
	type LinearClient,
	type LinearCreateIssueArgs,
	type LinearCreateIssueResult,
} from "./outcomes/tickets/linear";
export * from "./recorder";
export * from "./runner";
export * from "./trajectory";
export * from "./types";
export * from "./verifier";
