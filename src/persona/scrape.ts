/**
 * Persona scrape layer.
 *
 * Source adapters that pull candidate persona records from external
 * surfaces (LinkedIn-style bulk enrichment, GitHub Search, conference
 * talk indexes). Each adapter implements `PersonaScrapeSource` and is
 * pluggable; consumers wire whichever vendors they have access to.
 *
 * Counter-measure to representativeness gap: scraped populations skew
 * large-firm / English-speaking / public-profile. Consumers MUST stratify
 * by relevant facets before feeding into the fingerprint + evolve loop.
 * The evolve module prints a warning when the seed population fails a
 * basic stratification check; this module documents the requirement but
 * does not enforce it.
 *
 * IMPORTANT: the bundled sources (LinkedIn / GitHub / Conference) return
 * BUNDLED TOY DATA ONLY. They do not perform any real scraping or vendor
 * enrichment — that is left to consumers, who inject their own
 * PersonaScrapeSource implementation. To prevent a credential-shaped
 * surface from silently returning fake data, the credentialed sources
 * THROW when marked configured unless `allow_toy_fallback: true` is set.
 */

import { readFile } from "node:fs/promises";
import { namedLogger } from "../logger.js";

const log = namedLogger("@torus-oss/saga:persona-scrape");

export interface PersonaScrapeQuery {
	firm_name?: string;
	role_hints?: string[];
	domain_hints?: string[];
	max_records?: number;
}

export interface PersonaScrapeRecord {
	source: string;
	external_id: string;
	display_name: string;
	inferred_role: string | null;
	raw_text: string;
	metadata: Record<string, unknown>;
}

export interface PersonaScrapeSource {
	name: string;
	fetch(query: PersonaScrapeQuery): Promise<PersonaScrapeRecord[]>;
}

interface ToyBundle {
	source: string;
	records: PersonaScrapeRecord[];
}

export async function loadToyBundle(
	fixturePath: string,
): Promise<PersonaScrapeRecord[]> {
	const raw = await readFile(fixturePath, "utf-8");
	const parsed = JSON.parse(raw) as ToyBundle;
	return parsed.records;
}

export function matchesQuery(
	record: PersonaScrapeRecord,
	query: PersonaScrapeQuery,
): boolean {
	if (query.firm_name) {
		const firm = (record.metadata.firm as string | undefined) ?? "";
		const inText = record.raw_text
			.toLowerCase()
			.includes(query.firm_name.toLowerCase());
		const inMeta = firm.toLowerCase() === query.firm_name.toLowerCase();
		if (!inText && !inMeta) return false;
	}
	if (query.role_hints && query.role_hints.length > 0) {
		const role = (record.inferred_role ?? "").toLowerCase();
		const hit = query.role_hints.some((hint) =>
			role.includes(hint.toLowerCase()),
		);
		if (!hit) return false;
	}
	if (query.domain_hints && query.domain_hints.length > 0) {
		const domain = (record.metadata.domain as string | undefined) ?? "";
		const text = record.raw_text.toLowerCase();
		const hit = query.domain_hints.some((hint) => {
			const h = hint.toLowerCase();
			return domain.toLowerCase().includes(h) || text.includes(h);
		});
		if (!hit) return false;
	}
	return true;
}

export function applyQuery(
	records: PersonaScrapeRecord[],
	query: PersonaScrapeQuery,
): PersonaScrapeRecord[] {
	const cap = query.max_records ?? 25;
	const filtered = records.filter((r) => matchesQuery(r, query));
	return filtered.slice(0, cap);
}

/**
 * Reference adapter for LinkedIn-style bulk enrichment. Returns BUNDLED TOY
 * DATA ONLY — real vendor enrichment (Clay / Apollo / ZoomInfo) is NOT
 * implemented. If you set `vendor_configured` (signalling you expect real
 * data) it throws, unless you explicitly opt into the toy fallback with
 * `allow_toy_fallback: true`. For real data, inject your own
 * PersonaScrapeSource.
 */
export class LinkedInScrapeSource implements PersonaScrapeSource {
	readonly name = "linkedin";

	constructor(
		private readonly opts: {
			toy_bundle_path: string;
			vendor_configured?: boolean;
			vendor_label?: string;
			allow_toy_fallback?: boolean;
		},
	) {}

	async fetch(query: PersonaScrapeQuery): Promise<PersonaScrapeRecord[]> {
		if (this.opts.vendor_configured && !this.opts.allow_toy_fallback) {
			throw new Error(
				"LinkedInScrapeSource: real vendor enrichment is not implemented in " +
					"@torus-oss/saga. Inject your own PersonaScrapeSource, or pass " +
					"allow_toy_fallback: true to use bundled toy data.",
			);
		}
		if (this.opts.vendor_configured) {
			log.warn(
				"LinkedInScrapeSource: returning TOY data (allow_toy_fallback set); " +
					"real vendor enrichment is not implemented",
				{ vendor: this.opts.vendor_label ?? "unknown" },
			);
		}
		const records = await loadToyBundle(this.opts.toy_bundle_path);
		return applyQuery(records, query);
	}
}

/**
 * Reference adapter for GitHub authorship/search. Returns BUNDLED TOY DATA
 * ONLY — no real GitHub API call is made. Throws if `token_configured` is
 * set without `allow_toy_fallback: true`. Inject your own
 * PersonaScrapeSource for real data.
 */
export class GitHubScrapeSource implements PersonaScrapeSource {
	readonly name = "github";

	constructor(
		private readonly opts: {
			toy_bundle_path: string;
			token_configured?: boolean;
			allow_toy_fallback?: boolean;
		},
	) {}

	async fetch(query: PersonaScrapeQuery): Promise<PersonaScrapeRecord[]> {
		if (this.opts.token_configured && !this.opts.allow_toy_fallback) {
			throw new Error(
				"GitHubScrapeSource: real GitHub fetching is not implemented in " +
					"@torus-oss/saga. Inject your own PersonaScrapeSource, or pass " +
					"allow_toy_fallback: true to use bundled toy data.",
			);
		}
		if (this.opts.token_configured) {
			log.warn(
				"GitHubScrapeSource: returning TOY data (allow_toy_fallback set); " +
					"real GitHub fetching is not implemented",
			);
		}
		const records = await loadToyBundle(this.opts.toy_bundle_path);
		return applyQuery(records, query);
	}
}

/**
 * Reference adapter for conference-talk indexes. Returns BUNDLED TOY DATA
 * ONLY — there is no real index behind it. Inject your own
 * PersonaScrapeSource for real data.
 */
export class ConferenceTalkScrapeSource implements PersonaScrapeSource {
	readonly name = "conference_talks";

	constructor(private readonly opts: { toy_bundle_path: string }) {}

	async fetch(query: PersonaScrapeQuery): Promise<PersonaScrapeRecord[]> {
		const records = await loadToyBundle(this.opts.toy_bundle_path);
		return applyQuery(records, query);
	}
}

/** Run a query across multiple sources and union. */
export async function scrapeAll(
	sources: PersonaScrapeSource[],
	query: PersonaScrapeQuery,
): Promise<PersonaScrapeRecord[]> {
	const out: PersonaScrapeRecord[] = [];
	for (const src of sources) {
		const got = await src.fetch(query);
		out.push(...got);
	}
	return out;
}
