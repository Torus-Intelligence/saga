/**
 * Behavioral fingerprint extraction.
 *
 * Adapted from PPol (arxiv 2605.12894), which used a 19-dimension
 * behavioral fingerprint to drive evolutionary persona search. The
 * generic interface is defined here. Consumers supply their own
 * extractor with their own dimension vocabulary. Applications can ship
 * domain-specific extractors on top of this interface.
 *
 * Counter-measure to Bisbee variance collapse: the dimension list is
 * exported so the discriminator and the evolve loop both score and
 * report per-dimension coverage. Single-metric collapse is detectable
 * because the evolve loop emits per-dimension spread, not just
 * aggregate fitness.
 */

import type { PersonaScrapeRecord } from "./scrape";

export interface BehavioralFingerprint {
	dimensions: Record<string, number>;
	source_records: string[];
	fingerprint_version: number;
}

export interface FingerprintExtractor {
	name: string;
	dimensions(): readonly string[];
	extract(records: PersonaScrapeRecord[]): Promise<BehavioralFingerprint>;
}

/** Lowercase, strip punctuation, split on whitespace. */
export function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

/** Count keyword hits over tokenized text. Keywords are lowercased. */
export function countAny(toks: string[], keywords: string[]): number {
	const set = new Set(keywords.map((k) => k.toLowerCase()));
	let n = 0;
	for (const t of toks) if (set.has(t)) n++;
	return n;
}

/** Count multi-word phrases (substring match on joined text). */
export function countPhrases(text: string, phrases: string[]): number {
	const lower = text.toLowerCase();
	let n = 0;
	for (const p of phrases) {
		const needle = p.toLowerCase();
		let idx = 0;
		while (true) {
			const hit = lower.indexOf(needle, idx);
			if (hit < 0) break;
			n++;
			idx = hit + needle.length;
		}
	}
	return n;
}

/**
 * Normalize a count to [0, 1] via x / (x + k). Saturating, monotonic,
 * easy to reason about. k controls how fast the dimension saturates.
 */
export function normalize(count: number, k: number): number {
	if (count <= 0) return 0;
	return count / (count + k);
}

export interface AggregateText {
	combined: string;
	combinedTokens: string[];
	totalTokens: number;
	recordCount: number;
}

export function aggregate(records: PersonaScrapeRecord[]): AggregateText {
	const combined = records
		.map((r) => r.raw_text)
		.join("\n")
		.trim();
	const toks = tokens(combined);
	return {
		combined,
		combinedTokens: toks,
		totalTokens: toks.length,
		recordCount: records.length,
	};
}

/** Clamp a single dimension value into [0, 1]. */
export function clampDimension(v: number): number {
	if (!Number.isFinite(v)) return 0;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}
