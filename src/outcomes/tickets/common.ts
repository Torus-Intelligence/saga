/**
 * Shared ticket body + label constants used by every ticket sub-adapter.
 * Centralized so all three providers file structurally identical bodies,
 * differing only in markup conventions.
 */

import { readFileSync } from "node:fs";
import type { SagaOutcomeContext } from "../../types";

export const TICKET_LABELS = ["saga-failure", "auto-filed"] as const;

function readTrajectoryExcerptSync(path: string | null, maxLines = 40): string {
	if (!path) return "(no trajectory dump on disk)";
	try {
		const raw = readFileSync(path, "utf8");
		const lines = raw.trim().split("\n");
		if (lines.length <= maxLines) return lines.join("\n");
		const head = lines.slice(0, maxLines - 5);
		const tail = lines.slice(-5);
		return [...head, "... (truncated) ...", ...tail].join("\n");
	} catch (err) {
		return `(failed to read trajectory: ${(err as Error).message})`;
	}
}

export function buildTicketBody(ctx: SagaOutcomeContext): string {
	const excerpt = readTrajectoryExcerptSync(ctx.trajectory_path);
	const lines: string[] = [];
	lines.push("Auto-filed by saga outcome adapter. Review before triage.");
	lines.push("");
	lines.push("## Failing saga");
	lines.push(`- saga_id: \`${ctx.saga_id}\``);
	lines.push(`- fixture: \`${ctx.fixture_path}\``);
	lines.push(`- expected effect: \`${ctx.failure.expected.effect}\``);
	lines.push(`- miss reason: ${ctx.failure.reason}`);
	lines.push(`- miss count: ${ctx.failure.miss_count}`);
	lines.push(`- surprise count: ${ctx.failure.surprise_count}`);
	if (ctx.commit_hash) {
		lines.push(`- commit: \`${ctx.commit_hash}\``);
	}
	lines.push("");
	lines.push("## Observed effect kinds");
	if (ctx.emitted_effects.length === 0) {
		lines.push("- (none)");
	} else {
		for (const k of ctx.emitted_effects) {
			lines.push(`- \`${k}\``);
		}
	}
	lines.push("");
	lines.push("## Trajectory excerpt");
	lines.push("```");
	lines.push(excerpt);
	lines.push("```");
	return lines.join("\n");
}
