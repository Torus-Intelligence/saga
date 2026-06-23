import { describe, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubTwin, SlackTwin, StripeTwin } from "../twins/index.js";
import { Cassette } from "../cassette.js";

// ---------------------------------------------------------------------------
// GitHubTwin
// ---------------------------------------------------------------------------

describe("GitHubTwin", () => {
	test("createIssue returns API-shaped object", async () => {
		const twin = new GitHubTwin();
		const result = await twin.createIssue({ title: "Fix the bug", body: "details" });

		expect(typeof result.id).toBe("number");
		expect(typeof result.number).toBe("number");
		expect(result.title).toBe("Fix the bug");
		expect(result.state).toBe("open");
		expect(result.html_url).toMatch(/^https:\/\/github\.com\/example\/repo\/issues\/\d+$/);
		expect(result.id).toBe(result.number * 1000);
	});

	test("createIssue is deterministic across two calls", async () => {
		const twin = new GitHubTwin();
		const args = { title: "Determinism check" };
		const a = await twin.createIssue(args);
		const b = await twin.createIssue(args);

		expect(a.number).toBe(b.number);
		expect(a.id).toBe(b.id);
		expect(a.html_url).toBe(b.html_url);
	});

	test("getIssue returns API-shaped object", async () => {
		const twin = new GitHubTwin();
		const result = await twin.getIssue({ number: 42 });

		expect(result.number).toBe(42);
		expect(result.id).toBe(42 * 1000);
		expect(result.state).toBe("open");
	});
});

// ---------------------------------------------------------------------------
// SlackTwin
// ---------------------------------------------------------------------------

describe("SlackTwin", () => {
	test("postMessage returns ok:true with expected shape", async () => {
		const twin = new SlackTwin();
		const result = await twin.postMessage({ channel: "#general", text: "hello world" });

		expect(result.ok).toBe(true);
		expect(result.channel).toBe("#general");
		expect(typeof result.ts).toBe("string");
		// Slack ts format: digits.digits
		expect(result.ts).toMatch(/^\d+\.\d+$/);
	});

	test("postMessage ts is deterministic (not time-based)", async () => {
		const twin = new SlackTwin();
		const args = { channel: "#releases", text: "v1.0 shipped" };
		const a = await twin.postMessage(args);
		const b = await twin.postMessage(args);

		expect(a.ts).toBe(b.ts);
	});

	test("postMessage ts differs for different inputs", async () => {
		const twin = new SlackTwin();
		const a = await twin.postMessage({ channel: "#alpha", text: "msg1" });
		const b = await twin.postMessage({ channel: "#beta", text: "msg2" });

		expect(a.ts).not.toBe(b.ts);
	});
});

// ---------------------------------------------------------------------------
// StripeTwin
// ---------------------------------------------------------------------------

describe("StripeTwin", () => {
	test("createCustomer returns API-shaped object with cus_ prefix", async () => {
		const twin = new StripeTwin();
		const result = await twin.createCustomer({ email: "alice@example.com" });

		expect(result.id).toMatch(/^cus_/);
		expect(result.object).toBe("customer");
		expect(result.email).toBe("alice@example.com");
	});

	test("createCustomer id is deterministic", async () => {
		const twin = new StripeTwin();
		const a = await twin.createCustomer({ email: "bob@example.com" });
		const b = await twin.createCustomer({ email: "bob@example.com" });

		expect(a.id).toBe(b.id);
	});

	test("createCharge returns API-shaped object with ch_ prefix", async () => {
		const twin = new StripeTwin();
		const result = await twin.createCharge({ amount: 2000, customer: "cus_abc123" });

		expect(result.id).toMatch(/^ch_/);
		expect(result.object).toBe("charge");
		expect(result.amount).toBe(2000);
		expect(result.customer).toBe("cus_abc123");
		expect(result.status).toBe("succeeded");
	});

	test("createCharge id is deterministic", async () => {
		const twin = new StripeTwin();
		const a = await twin.createCharge({ amount: 500, customer: "cus_xyz" });
		const b = await twin.createCharge({ amount: 500, customer: "cus_xyz" });

		expect(a.id).toBe(b.id);
	});
});

// ---------------------------------------------------------------------------
// Cassette record → replay flow (worked example)
// ---------------------------------------------------------------------------

describe("Cassette record/replay with twins", () => {
	test("GitHubTwin: record then replay returns identical result without regenerating", async () => {
		const dir = await mkdtemp(join(tmpdir(), "saga-twins-test-"));
		const path = join(dir, "cassette.json");

		try {
			// --- record phase ---
			const recordCassette = new Cassette({ mode: "record", path });
			const recordTwin = new GitHubTwin(recordCassette);
			const recorded = await recordTwin.createIssue({ title: "Replay test issue" });
			recordCassette.save();

			// --- replay phase ---
			const replayCassette = Cassette.load(path);
			const replayTwin = new GitHubTwin(replayCassette);
			const replayed = await replayTwin.createIssue({ title: "Replay test issue" });

			// Identical result
			expect(replayed).toEqual(recorded);

			// Replay cassette is in replay mode — a miss on an unknown key throws
			await expect(
				replayTwin.createIssue({ title: "This key was never recorded" }),
			).rejects.toThrow("cassette replay miss");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("SlackTwin: record then replay returns identical result", async () => {
		const dir = await mkdtemp(join(tmpdir(), "saga-twins-test-"));
		const path = join(dir, "cassette.json");

		try {
			const recordCassette = new Cassette({ mode: "record", path });
			const recordTwin = new SlackTwin(recordCassette);
			const recorded = await recordTwin.postMessage({ channel: "#test", text: "hello cassette" });
			recordCassette.save();

			const replayCassette = Cassette.load(path);
			const replayTwin = new SlackTwin(replayCassette);
			const replayed = await replayTwin.postMessage({ channel: "#test", text: "hello cassette" });

			expect(replayed).toEqual(recorded);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("StripeTwin: record then replay returns identical result", async () => {
		const dir = await mkdtemp(join(tmpdir(), "saga-twins-test-"));
		const path = join(dir, "cassette.json");

		try {
			const recordCassette = new Cassette({ mode: "record", path });
			const recordTwin = new StripeTwin(recordCassette);
			const recordedCustomer = await recordTwin.createCustomer({ email: "replay@example.com" });
			const recordedCharge = await recordTwin.createCharge({
				amount: 1500,
				customer: recordedCustomer.id,
			});
			recordCassette.save();

			const replayCassette = Cassette.load(path);
			const replayTwin = new StripeTwin(replayCassette);
			const replayedCustomer = await replayTwin.createCustomer({ email: "replay@example.com" });
			const replayedCharge = await replayTwin.createCharge({
				amount: 1500,
				customer: replayedCustomer.id,
			});

			expect(replayedCustomer).toEqual(recordedCustomer);
			expect(replayedCharge).toEqual(recordedCharge);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
