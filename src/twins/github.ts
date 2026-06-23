import { Cassette, cassetteKey } from "../cassette.js";

/**
 * Deterministic hash: sum of char codes, result fits in a safe integer.
 */
function charSum(s: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		n += s.charCodeAt(i);
	}
	return n;
}

export class GitHubTwin {
	readonly cassette: Cassette;

	constructor(cassette: Cassette = new Cassette()) {
		this.cassette = cassette;
	}

	async createIssue(args: {
		title: string;
		body?: string;
	}): Promise<{
		id: number;
		number: number;
		html_url: string;
		title: string;
		state: "open";
	}> {
		const key = cassetteKey(["GitHubTwin", "createIssue", args]);
		return this.cassette.use(key, () => {
			const number = (charSum(args.title) % 1000) + 1;
			const id = number * 1000;
			return {
				id,
				number,
				html_url: `https://github.com/example/repo/issues/${number}`,
				title: args.title,
				state: "open" as const,
			};
		});
	}

	async getIssue(args: {
		number: number;
	}): Promise<{
		id: number;
		number: number;
		state: "open";
	}> {
		const key = cassetteKey(["GitHubTwin", "getIssue", args]);
		return this.cassette.use(key, () => {
			const id = args.number * 1000;
			return {
				id,
				number: args.number,
				state: "open" as const,
			};
		});
	}
}
