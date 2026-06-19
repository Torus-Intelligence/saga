/**
 * Linear ticket sub-adapter. Opens an issue via the Linear GraphQL API
 * and tags it `saga-failure`, `auto-filed`.
 */

import { namedLogger } from "../../logger.js";
import type { SagaOutcomeContext } from "../../types.js";
import { buildTicketBody, TICKET_LABELS } from "./common.js";

const log = namedLogger("@torus/saga:linear-ticket");

export interface LinearConfig {
	api_key?: string;
	team_id?: string;
}

let runtimeConfig: LinearConfig = {};

export function configureLinear(cfg: LinearConfig): void {
	runtimeConfig = { ...runtimeConfig, ...cfg };
}

export interface LinearCreateIssueArgs {
	team_id: string;
	title: string;
	description: string;
	labels: string[];
	api_key: string;
}

export interface LinearCreateIssueResult {
	id: string;
	url: string;
}

export interface LinearClient {
	createIssue(args: LinearCreateIssueArgs): Promise<LinearCreateIssueResult>;
}

const defaultLinearClient: LinearClient = {
	async createIssue(args) {
		const query = `mutation IssueCreate($input: IssueCreateInput!) {
			issueCreate(input: $input) { success issue { id url } }
		}`;
		const res = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				Authorization: args.api_key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query,
				variables: {
					input: {
						teamId: args.team_id,
						title: args.title,
						description: args.description,
						labelIds: args.labels,
					},
				},
			}),
		});
		if (!res.ok) {
			throw new Error(`Linear: HTTP ${res.status} creating issue`);
		}
		const json = (await res.json()) as {
			data?: {
				issueCreate?: {
					success: boolean;
					issue?: { id: string; url: string };
				};
			};
		};
		const issue = json.data?.issueCreate?.issue;
		if (!issue)
			throw new Error("Linear: missing issueCreate.issue in response");
		return { id: issue.id, url: issue.url };
	},
};

let injectedClient: LinearClient | null = null;

export function __setLinearClientForTest(client: LinearClient | null): void {
	injectedClient = client;
}

export function getLinearClient(): LinearClient {
	return injectedClient ?? defaultLinearClient;
}

export async function handleLinearFailure(
	ctx: SagaOutcomeContext,
): Promise<
	| { kind: "ticket_filed"; ticket_url: string; ticket_id: string }
	| { kind: "noop"; reason: string }
> {
	const apiKey = process.env.LINEAR_API_KEY ?? runtimeConfig.api_key;
	const teamId = process.env.LINEAR_TEAM_ID ?? runtimeConfig.team_id;
	if (!apiKey || !teamId) {
		return {
			kind: "noop",
			reason:
				"Linear ticket adapter requires LINEAR_API_KEY and LINEAR_TEAM_ID",
		};
	}
	const client = getLinearClient();
	const issue = await client.createIssue({
		team_id: teamId,
		title: `Saga failure: ${ctx.saga_id}`,
		description: buildTicketBody(ctx),
		labels: [...TICKET_LABELS],
		api_key: apiKey,
	});
	log.info(`linear-ticket filed ${issue.url} for saga ${ctx.saga_id}`);
	return { kind: "ticket_filed", ticket_url: issue.url, ticket_id: issue.id };
}
