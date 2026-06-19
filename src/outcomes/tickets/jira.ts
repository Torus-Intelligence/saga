/**
 * Jira ticket sub-adapter. Opens an issue via the Jira Cloud REST API
 * and tags it `saga-failure`, `auto-filed`.
 */

import { namedLogger } from "../../logger.js";
import type { SagaOutcomeContext } from "../../types.js";
import { buildTicketBody, TICKET_LABELS } from "./common.js";

const log = namedLogger("@torus-oss/saga:jira-ticket");

export interface JiraConfig {
	host?: string;
	user?: string;
	token?: string;
	project_key?: string;
}

let runtimeConfig: JiraConfig = {};

export function configureJira(cfg: JiraConfig): void {
	runtimeConfig = { ...runtimeConfig, ...cfg };
}

export interface JiraCreateIssueArgs {
	host: string;
	user: string;
	token: string;
	project_key: string;
	summary: string;
	description: string;
	labels: string[];
}

export interface JiraCreateIssueResult {
	id: string;
	key: string;
	url: string;
}

export interface JiraClient {
	createIssue(args: JiraCreateIssueArgs): Promise<JiraCreateIssueResult>;
}

const defaultJiraClient: JiraClient = {
	async createIssue(args) {
		const auth = Buffer.from(`${args.user}:${args.token}`).toString("base64");
		const res = await fetch(`${args.host}/rest/api/3/issue`, {
			method: "POST",
			headers: {
				Authorization: `Basic ${auth}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				fields: {
					project: { key: args.project_key },
					summary: args.summary,
					description: args.description,
					issuetype: { name: "Bug" },
					labels: args.labels,
				},
			}),
		});
		if (!res.ok) {
			throw new Error(`Jira: HTTP ${res.status} creating issue`);
		}
		const json = (await res.json()) as { id: string; key: string };
		return {
			id: json.id,
			key: json.key,
			url: `${args.host}/browse/${json.key}`,
		};
	},
};

let injectedClient: JiraClient | null = null;

export function __setJiraClientForTest(client: JiraClient | null): void {
	injectedClient = client;
}

export function getJiraClient(): JiraClient {
	return injectedClient ?? defaultJiraClient;
}

export async function handleJiraFailure(
	ctx: SagaOutcomeContext,
): Promise<
	| { kind: "ticket_filed"; ticket_url: string; ticket_id: string }
	| { kind: "noop"; reason: string }
> {
	const host = process.env.JIRA_HOST ?? runtimeConfig.host;
	const user = process.env.JIRA_USER ?? runtimeConfig.user;
	const token = process.env.JIRA_TOKEN ?? runtimeConfig.token;
	const projectKey = process.env.JIRA_PROJECT_KEY ?? runtimeConfig.project_key;
	if (!host || !user || !token || !projectKey) {
		return {
			kind: "noop",
			reason:
				"Jira ticket adapter requires JIRA_HOST, JIRA_USER, JIRA_TOKEN, JIRA_PROJECT_KEY",
		};
	}
	const client = getJiraClient();
	const issue = await client.createIssue({
		host,
		user,
		token,
		project_key: projectKey,
		summary: `Saga failure: ${ctx.saga_id}`,
		description: buildTicketBody(ctx),
		labels: [...TICKET_LABELS],
	});
	log.info(`jira-ticket filed ${issue.url} for saga ${ctx.saga_id}`);
	return { kind: "ticket_filed", ticket_url: issue.url, ticket_id: issue.key };
}
