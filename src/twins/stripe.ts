import { Cassette, cassetteKey } from "../cassette.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Deterministic djb2-style hash, returns a non-negative 32-bit integer.
 */
function stableHash(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
	}
	return h;
}

/**
 * Encode a seed into an alphanumeric string of the given length.
 */
function hashId(seed: string, len = 14): string {
	let h = stableHash(seed);
	let result = "";
	for (let i = 0; i < len; i++) {
		result += ALPHABET[h % ALPHABET.length];
		// Advance the hash to get different characters
		h = stableHash(result + seed);
	}
	return result;
}

export class StripeTwin {
	readonly cassette: Cassette;

	constructor(cassette: Cassette = new Cassette()) {
		this.cassette = cassette;
	}

	async createCustomer(args: {
		email: string;
	}): Promise<{
		id: string;
		object: "customer";
		email: string;
	}> {
		const key = cassetteKey(["StripeTwin", "createCustomer", args]);
		return this.cassette.use(key, () => {
			return {
				id: `cus_${hashId(args.email)}`,
				object: "customer" as const,
				email: args.email,
			};
		});
	}

	async createCharge(args: {
		amount: number;
		customer: string;
	}): Promise<{
		id: string;
		object: "charge";
		amount: number;
		customer: string;
		status: "succeeded";
	}> {
		const key = cassetteKey(["StripeTwin", "createCharge", args]);
		return this.cassette.use(key, () => {
			const seed = `${args.amount}:${args.customer}`;
			return {
				id: `ch_${hashId(seed)}`,
				object: "charge" as const,
				amount: args.amount,
				customer: args.customer,
				status: "succeeded" as const,
			};
		});
	}
}
