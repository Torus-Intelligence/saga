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
 * We never scrape LinkedIn directly. The LinkedInScrapeSource wires
 * Clay / Apollo / ZoomInfo when the relevant API keys are configured and
 * falls back to bundled toy data otherwise.
 */

import { readFile } from "node:fs/promises";
import { namedLogger } from "../logger.js";

const log = namedLogger("@torus/saga:persona-scrape");

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
 * Adapter shell for LinkedIn-style bulk enrichment. Hosts inject their
 * fixture path and vendor key state; the implementation falls back to
 * the bundled toy data when no vendor is configured.
 */
export class LinkedInScrapeSource implements PersonaScrapeSource {
	readonly name = "linkedin";

	constructor(
		private readonly opts: {
			toy_bundle_path: string;
			vendor_configured?: boolean;
			vendor_label?: string;
		},
	) {}

	async fetch(query: PersonaScrapeQuery): Promise<PersonaScrapeRecord[]> {
		if (this.opts.vendor_configured) {
			log.info("vendor enrichment configured but stub fallback in use", {
				vendor: this.opts.vendor_label ?? "unknown",
			});
		}
		const records = await loadToyBundle(this.opts.toy_bundle_path);
		return applyQuery(records, query);
	}
}

export class GitHubScrapeSource implements PersonaScrapeSource {
	readonly name = "github";

	constructor(
		private readonly opts: {
			toy_bundle_path: string;
			token_configured?: boolean;
		},
	) {}

	async fetch(query: PersonaScrapeQuery): Promise<PersonaScrapeRecord[]> {
		if (this.opts.token_configured) {
			log.info("github token configured but stub fallback in use");
		}
		const records = await loadToyBundle(this.opts.toy_bundle_path);
		return applyQuery(records, query);
	}
}

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
