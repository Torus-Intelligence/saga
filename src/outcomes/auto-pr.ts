/**
 * Auto-PR outcome adapter. On saga failure, asks an LLM drafter to draft
 * a fix, opens a branch, applies a memo file, pushes, and files a draft
 * PR for human review.
 *
 * Every PR opened by this adapter is a DRAFT. The adapter never lands a
 * fix automatically; a human approves and merges. The "draft for human
 * review" disclaimer is hard-coded into the PR body.
 *
 * Both the Git host side (GitHubClient) and the LLM side (LlmDrafter) are
 * pluggable interfaces. The default GitHubClient hits the GitHub REST API
 * using env-configured credentials. The default LlmDrafter is a no-op
 * that returns a placeholder; downstream consumers wire their own.
 */

import { readFile } from "node:fs/promises";
import { namedLogger } from "../logger.js";
import type { SagaOutcomeAdapter, SagaOutcomeContext } from "../types.js";

const log = namedLogger("@torus-oss/saga:auto-pr");

export interface AutoPrConfig {
	github_token?: string;
	github_repo?: string;
	base_branch?: string;
}

let runtimeConfig: AutoPrConfig = {};

export function configureAutoPr(cfg: AutoPrConfig): void {
	runtimeConfig = { ...runtimeConfig, ...cfg };
}

export interface CreateBranchArgs {
	repo: string;
	branch: string;
	base: string;
	token: string;
}

export interface CommitFileArgs {
	repo: string;
	branch: string;
	path: string;
	content: string;
	message: string;
	token: string;
}

export interface CreatePullRequestArgs {
	repo: string;
	head: string;
	base: string;
	title: string;
	body: string;
	draft: boolean;
	token: string;
}

export interface CreatePullRequestResult {
	pr_url: string;
	pr_number: number;
}

export interface GitHubClient {
	createBranch(args: CreateBranchArgs): Promise<void>;
	commitFile(args: CommitFileArgs): Promise<void>;
	createPullRequest(
		args: CreatePullRequestArgs,
	): Promise<CreatePullRequestResult>;
}

const defaultGitHubClient: GitHubClient = {
	async createBranch(args) {
		const headers = githubHeaders(args.token);
		const ref = await fetch(
			`https://api.github.com/repos/${args.repo}/git/ref/heads/${args.base}`,
			{ headers },
		);
		if (!ref.ok) {
			throw new Error(
				`auto-PR: failed to look up base branch "${args.base}" on ${args.repo} (HTTP ${ref.status})`,
			);
		}
		const refJson = (await ref.json()) as { object: { sha: string } };
		const res = await fetch(
			`https://api.github.com/repos/${args.repo}/git/refs`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					ref: `refs/heads/${args.branch}`,
					sha: refJson.object.sha,
				}),
			},
		);
		if (!res.ok) {
			throw new Error(
				`auto-PR: failed to create branch "${args.branch}" on ${args.repo} (HTTP ${res.status})`,
			);
		}
	},
	async commitFile(args) {
		const headers = githubHeaders(args.token);
		const existing = await fetch(
			`https://api.github.com/repos/${args.repo}/contents/${args.path}?ref=${args.branch}`,
			{ headers },
		);
		let sha: string | undefined;
		if (existing.ok) {
			const json = (await existing.json()) as { sha: string };
			sha = json.sha;
		}
		const res = await fetch(
			`https://api.github.com/repos/${args.repo}/contents/${args.path}`,
			{
				method: "PUT",
				headers,
				body: JSON.stringify({
					message: args.message,
					content: Buffer.from(args.content, "utf8").toString("base64"),
					branch: args.branch,
					sha,
				}),
			},
		);
		if (!res.ok) {
			throw new Error(
				`auto-PR: failed to commit "${args.path}" on ${args.repo}@${args.branch} (HTTP ${res.status})`,
			);
		}
	},
	async createPullRequest(args) {
		const headers = githubHeaders(args.token);
		const res = await fetch(`https://api.github.com/repos/${args.repo}/pulls`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				title: args.title,
				head: args.head,
				base: args.base,
				body: args.body,
				draft: args.draft,
			}),
		});
		if (!res.ok) {
			throw new Error(
				`auto-PR: failed to create pull request on ${args.repo} (HTTP ${res.status})`,
			);
		}
		const json = (await res.json()) as {
			html_url: string;
			number: number;
		};
		return { pr_url: json.html_url, pr_number: json.number };
	},
};

function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"Content-Type": "application/json",
	};
}

let injectedClient: GitHubClient | null = null;

export function __setGitHubClientForTest(client: GitHubClient | null): void {
	injectedClient = client;
}

export function getGitHubClient(): GitHubClient {
	return injectedClient ?? defaultGitHubClient;
}

export interface LlmDrafter {
	draftFix(args: {
		saga_id: string;
		expected_kind: string;
		reason: string;
		emitted_effects: string[];
		trajectory_excerpt: string;
	}): Promise<{ reasoning: string; suggested_diff: string }>;
}

/**
 * Default drafter is a no-op placeholder. Downstream consumers inject a
 * real LLM-backed drafter via __setLlmDrafterForTest / configureAutoPr.
 */
const noopDrafter: LlmDrafter = {
	async draftFix() {
		return {
			reasoning:
				"(no LLM drafter configured; inject one via __setLlmDrafterForTest)",
			suggested_diff: "",
		};
	},
};

let injectedDrafter: LlmDrafter | null = null;

export function __setLlmDrafterForTest(drafter: LlmDrafter | null): void {
	injectedDrafter = drafter;
}

export function getLlmDrafter(): LlmDrafter {
	return injectedDrafter ?? noopDrafter;
}

export function parseDrafterReply(content: string): {
	reasoning: string;
	suggested_diff: string;
} {
	const reasoningMatch = content.match(
		/REASONING\s*:?\s*([\s\S]*?)(?=SUGGESTED_DIFF|$)/i,
	);
	const diffMatch = content.match(/SUGGESTED_DIFF\s*:?\s*([\s\S]*)/i);
	return {
		reasoning: (reasoningMatch?.[1] ?? content).trim(),
		suggested_diff: (diffMatch?.[1] ?? "").trim(),
	};
}

export function buildBranchName(saga_id: string, nowMs: number): string {
	const ts = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
	return `saga-fix/${saga_id}-${ts}`;
}

export function buildPullRequestBody(args: {
	saga_id: string;
	fixture_path: string;
	expected_kind: string;
	reason: string;
	emitted_effects: string[];
	trajectory_excerpt: string;
	draft_reasoning: string;
	suggested_diff: string;
}): string {
	const lines: string[] = [];
	lines.push("Draft for human review. Do not merge without verification.");
	lines.push("");
	lines.push("## Failing saga");
	lines.push(`- saga_id: \`${args.saga_id}\``);
	lines.push(`- fixture: \`${args.fixture_path}\``);
	lines.push(`- expected effect: \`${args.expected_kind}\``);
	lines.push(`- miss reason: ${args.reason}`);
	lines.push("");
	lines.push("## Observed effect kinds");
	if (args.emitted_effects.length === 0) {
		lines.push("- (none)");
	} else {
		for (const k of args.emitted_effects) {
			lines.push(`- \`${k}\``);
		}
	}
	lines.push("");
	lines.push("## Trajectory excerpt");
	lines.push("```");
	lines.push(args.trajectory_excerpt);
	lines.push("```");
	lines.push("");
	lines.push("## Draft reasoning");
	lines.push(args.draft_reasoning);
	lines.push("");
	lines.push("## Suggested diff");
	lines.push("```diff");
	lines.push(args.suggested_diff || "(no diff produced)");
	lines.push("```");
	return lines.join("\n");
}

async function readTrajectoryExcerpt(
	path: string | null,
	maxLines = 40,
): Promise<string> {
	if (!path) return "(no trajectory dump on disk)";
	try {
		const raw = await readFile(path, "utf8");
		const lines = raw.trim().split("\n");
		if (lines.length <= maxLines) return lines.join("\n");
		const head = lines.slice(0, maxLines - 5);
		const tail = lines.slice(-5);
		return [...head, "... (truncated) ...", ...tail].join("\n");
	} catch (err) {
		return `(failed to read trajectory: ${(err as Error).message})`;
	}
}

export const autoPrAdapter: SagaOutcomeAdapter = {
	name: "auto_pr",
	async handleFailure(ctx: SagaOutcomeContext) {
		const token =
			process.env.SAGA_AUTOPR_GITHUB_TOKEN ?? runtimeConfig.github_token;
		const repo = process.env.SAGA_AUTOPR_REPO ?? runtimeConfig.github_repo;
		const base =
			process.env.SAGA_AUTOPR_BASE_BRANCH ??
			runtimeConfig.base_branch ??
			"main";
		if (!token || !repo) {
			return {
				kind: "noop",
				reason:
					"auto-PR adapter requires SAGA_AUTOPR_GITHUB_TOKEN and SAGA_AUTOPR_REPO",
			};
		}

		const excerpt = await readTrajectoryExcerpt(ctx.trajectory_path);
		const drafter = getLlmDrafter();
		const draft = await drafter.draftFix({
			saga_id: ctx.saga_id,
			expected_kind: ctx.failure.expected.effect,
			reason: ctx.failure.reason,
			emitted_effects: ctx.emitted_effects,
			trajectory_excerpt: excerpt,
		});

		const branch = buildBranchName(ctx.saga_id, Date.now());
		const client = getGitHubClient();
		await client.createBranch({ repo, branch, base, token });

		const memoPath = `.saga-fix/${ctx.saga_id}.md`;
		const memo = [
			`# Saga fix candidate: ${ctx.saga_id}`,
			"",
			"## Reasoning",
			draft.reasoning,
			"",
			"## Suggested diff",
			"```diff",
			draft.suggested_diff || "(no diff produced)",
			"```",
		].join("\n");
		await client.commitFile({
			repo,
			branch,
			path: memoPath,
			content: memo,
			message: `saga-fix: candidate for ${ctx.saga_id}`,
			token,
		});

		const body = buildPullRequestBody({
			saga_id: ctx.saga_id,
			fixture_path: ctx.fixture_path,
			expected_kind: ctx.failure.expected.effect,
			reason: ctx.failure.reason,
			emitted_effects: ctx.emitted_effects,
			trajectory_excerpt: excerpt,
			draft_reasoning: draft.reasoning,
			suggested_diff: draft.suggested_diff,
		});

		const pr = await client.createPullRequest({
			repo,
			head: branch,
			base,
			title: `saga-fix: ${ctx.saga_id}`,
			body,
			draft: true,
			token,
		});

		log.info(
			`auto-PR opened draft PR ${pr.pr_url} for saga ${ctx.saga_id} on ${repo}`,
		);

		return {
			kind: "pr_drafted",
			pr_url: pr.pr_url,
			pr_number: pr.pr_number,
		};
	},
};
