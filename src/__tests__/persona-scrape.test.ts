import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	GitHubScrapeSource,
	LinkedInScrapeSource,
} from "../persona/scrape.js";

async function writeToyBundle(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "saga-scrape-"));
	const path = join(dir, "toy.json");
	await writeFile(
		path,
		JSON.stringify({
			source: "toy",
			records: [
				{
					source: "toy",
					external_id: "1",
					display_name: "Toy Person",
					inferred_role: "engineer",
					raw_text: "toy record",
					metadata: {},
				},
			],
		}),
	);
	return path;
}

test("LinkedInScrapeSource throws when vendor_configured without allow_toy_fallback", async () => {
	const toy = await writeToyBundle();
	const src = new LinkedInScrapeSource({
		toy_bundle_path: toy,
		vendor_configured: true,
	});
	await expect(src.fetch({})).rejects.toThrow(/not implemented/i);
});

test("LinkedInScrapeSource returns toy data when allow_toy_fallback is set", async () => {
	const toy = await writeToyBundle();
	const src = new LinkedInScrapeSource({
		toy_bundle_path: toy,
		vendor_configured: true,
		allow_toy_fallback: true,
	});
	const records = await src.fetch({});
	expect(records.length).toBeGreaterThan(0);
});

test("LinkedInScrapeSource returns toy data when no vendor is configured", async () => {
	const toy = await writeToyBundle();
	const src = new LinkedInScrapeSource({ toy_bundle_path: toy });
	const records = await src.fetch({});
	expect(records.length).toBeGreaterThan(0);
});

test("GitHubScrapeSource throws when token_configured without allow_toy_fallback", async () => {
	const toy = await writeToyBundle();
	const src = new GitHubScrapeSource({
		toy_bundle_path: toy,
		token_configured: true,
	});
	await expect(src.fetch({})).rejects.toThrow(/not implemented/i);
});
