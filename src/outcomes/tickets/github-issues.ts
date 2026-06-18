/**
 * GitHub Issues ticket sub-adapter. Opens an issue via the GitHub REST
 * API and tags it `saga-failure`, `auto-filed`.
 */

import { namedLogger } from "../../logger";
import type { SagaOutcomeContext } from "../../types";
import { buildTicketBody, TICKET_LABELS } from "./common";

const log = namedLogger("saga-core:github-issue");

export interface GitHubIssuesConfig {
	token?: string;
	repo?: string;
}

let runtimeConfig: GitHubIssuesConfig = {};

export function configureGitHubIssues(cfg: GitHubIssuesConfig): void {
	runtimeConfig = { ...runtimeConfig, ...cfg };
}

export interface GitHubIssueCreateArgs {
	repo: string;
	token: string;
	title: string;
	body: string;
	labels: string[];
}

export interface GitHubIssueCreateResult {
	id: string;
	number: number;
	url: string;
}

export interface GitHubIssuesClient {
	createIssue(args: GitHubIssueCreateArgs): Promise<GitHubIssueCreateResult>;
}

const defaultGitHubIssuesClient: GitHubIssuesClient = {
	async createIssue(args) {
		const res = await fetch(
			`https://api.github.com/repos/${args.repo}/issues`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${args.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: args.title,
					body: args.body,
					labels: args.labels,
				}),
			},
		);
		if (!res.ok) {
			throw new Error(
				`GitHub Issues: HTTP ${res.status} creating issue on ${args.repo}`,
			);
		}
		const json = (await res.json()) as {
			node_id: string;
			number: number;
			html_url: string;
		};
		return { id: json.node_id, number: json.number, url: json.html_url };
	},
};

let injectedClient: GitHubIssuesClient | null = null;

export function __setGitHubIssuesClientForTest(
	client: GitHubIssuesClient | null,
): void {
	injectedClient = client;
}

export function getGitHubIssuesClient(): GitHubIssuesClient {
	return injectedClient ?? defaultGitHubIssuesClient;
}

export async function handleGitHubIssueFailure(
	ctx: SagaOutcomeContext,
): Promise<
	| { kind: "ticket_filed"; ticket_url: string; ticket_id: string }
	| { kind: "noop"; reason: string }
> {
	const token = process.env.GITHUB_TOKEN ?? runtimeConfig.token;
	const repo = process.env.GITHUB_REPO ?? runtimeConfig.repo;
	if (!token || !repo) {
		return {
			kind: "noop",
			reason: "GitHub Issues adapter requires GITHUB_TOKEN and GITHUB_REPO",
		};
	}
	const client = getGitHubIssuesClient();
	const issue = await client.createIssue({
		repo,
		token,
		title: `Saga failure: ${ctx.saga_id}`,
		body: buildTicketBody(ctx),
		labels: [...TICKET_LABELS],
	});
	log.info(`github-issue filed ${issue.url} for saga ${ctx.saga_id}`);
	return {
		kind: "ticket_filed",
		ticket_url: issue.url,
		ticket_id: String(issue.number),
	};
}
