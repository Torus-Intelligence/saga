/**
 * Structured trajectory recorder. Accumulates events, effects, and
 * assertion failures in memory as a saga runs. On failure, the runner
 * dumps the trajectory as JSONL for human postmortem review.
 *
 * This is NOT a deterministic-replay substrate. LLM non-determinism
 * remains an open problem; record-and-replay is for review, not
 * verification.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CURRENT_HARNESS_VERSION } from "./types.js";

export interface TrajectoryHeader {
	saga_id: string;
	harness_version: number;
	fixture_path: string;
	started_at: string;
	seed: number;
	commit_hash: string;
}

export type TrajectoryEntry =
	| {
			type: "event";
			event_index: number;
			event_kind: string;
			payload: Record<string, unknown>;
	  }
	| {
			type: "effect";
			event_index: number;
			effect_kind: string;
			payload: Record<string, unknown>;
	  }
	| {
			type: "assertion_failure";
			event_index: number;
			expected: unknown;
			actual: unknown;
			mismatch_reason: string;
	  };

export class TrajectoryRecorder {
	private readonly header: TrajectoryHeader;
	private readonly entries: TrajectoryEntry[] = [];

	constructor(args: {
		saga_id: string;
		fixture_path: string;
		harness_version?: number;
		seed?: number;
	}) {
		this.header = {
			saga_id: args.saga_id,
			harness_version: args.harness_version ?? CURRENT_HARNESS_VERSION,
			fixture_path: args.fixture_path,
			started_at: new Date().toISOString(),
			seed: resolveSeed(args.seed),
			commit_hash: resolveCommitHash(),
		};
	}

	/** The resolved seed recorded for this run. Re-run with SAGA_SEED=<seed> to reproduce. */
	get seed(): number {
		return this.header.seed;
	}

	record(entry: TrajectoryEntry): void {
		this.entries.push(entry);
	}

	get entryCount(): number {
		return this.entries.length;
	}

	dump(outputPath: string): void {
		const dir = dirname(outputPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const lines: string[] = [];
		lines.push(JSON.stringify({ type: "header", ...this.header }));
		for (const e of this.entries) {
			lines.push(JSON.stringify(e));
		}
		writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
	}

	snapshot(): { header: TrajectoryHeader; entries: TrajectoryEntry[] } {
		return { header: this.header, entries: [...this.entries] };
	}
}

/**
 * Resolve the run seed: explicit argument, else the SAGA_SEED env var, else
 * a random 32-bit seed. The resolved value is recorded in the trajectory
 * header so any run can be reproduced with SAGA_SEED=<seed>.
 */
export function resolveSeed(explicit?: number): number {
	if (typeof explicit === "number" && Number.isFinite(explicit)) {
		return Math.floor(explicit);
	}
	const env = process.env.SAGA_SEED;
	if (env !== undefined && env !== "") {
		const parsed = Number.parseInt(env, 10);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Math.floor(Math.random() * 0x1_0000_0000);
}

function resolveCommitHash(): string {
	const envHash =
		process.env.SAGA_COMMIT_SHA ??
		process.env.TORUS_COMMIT_SHA ??
		process.env.GIT_COMMIT ??
		process.env.GITHUB_SHA;
	if (envHash) return envHash;
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return "";
	}
}

export function trajectoryDumpEnabled(): boolean {
	const flag = process.env.TRAJECTORY_DUMP_ENABLED;
	if (flag === undefined) return true;
	return flag === "1" || flag.toLowerCase() === "true";
}
