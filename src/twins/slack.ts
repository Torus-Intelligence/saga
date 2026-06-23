import { Cassette, cassetteKey } from "../cassette.js";

/**
 * Deterministic hash: djb2-style, returns a non-negative integer.
 */
function stableHash(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
	}
	return h;
}

export class SlackTwin {
	readonly cassette: Cassette;

	constructor(cassette: Cassette = new Cassette()) {
		this.cassette = cassette;
	}

	async postMessage(args: {
		channel: string;
		text: string;
	}): Promise<{
		ok: true;
		channel: string;
		ts: string;
	}> {
		const key = cassetteKey(["SlackTwin", "postMessage", args]);
		return this.cassette.use(key, () => {
			const h = stableHash(args.channel + "\0" + args.text);
			// Format as a Slack-style timestamp: "seconds.microseconds"
			const ts = `${1000000 + (h % 9000000)}.${String(h % 1000000).padStart(6, "0")}`;
			return {
				ok: true as const,
				channel: args.channel,
				ts,
			};
		});
	}
}
