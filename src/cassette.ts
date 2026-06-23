import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CassetteMode = "record" | "replay" | "off";

export interface CassetteData {
	version: number;
	entries: Record<string, unknown>;
}

export interface CassetteOptions {
	mode?: CassetteMode;
	path?: string;
}

export function resolveCassetteMode(explicit?: CassetteMode): CassetteMode {
	if (explicit !== undefined) return explicit;
	const env = process.env.SAGA_CASSETTE_MODE;
	if (env === "record" || env === "replay" || env === "off") return env;
	return "off";
}

function sortedReplacer(_key: string, value: unknown): unknown {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		const sorted: Record<string, unknown> = {};
		for (const k of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[k] = (value as Record<string, unknown>)[k];
		}
		return sorted;
	}
	return value;
}

export function cassetteKey(parts: unknown): string {
	return JSON.stringify(parts, sortedReplacer);
}

/** @internal symbol used by `Cassette.load` to bypass mode-gated loading */
const LOAD_FROM = Symbol("LOAD_FROM");

export class Cassette {
	readonly #mode: CassetteMode;
	readonly #path: string | undefined;
	readonly #entries: Map<string, unknown>;

	constructor(opts: CassetteOptions = {}) {
		this.#mode = resolveCassetteMode(opts.mode);
		this.#path = opts.path;
		this.#entries = new Map();

		if (this.#mode === "replay" && this.#path && existsSync(this.#path)) {
			this.#loadFrom(this.#path);
		}
	}

	#loadFrom(path: string): void {
		const raw = readFileSync(path, "utf8");
		const data = JSON.parse(raw) as CassetteData;
		for (const [k, v] of Object.entries(data.entries)) {
			this.#entries.set(k, v);
		}
	}

	/** @internal used by static load to force-populate entries after construction */
	[LOAD_FROM](path: string): void {
		this.#entries.clear();
		this.#loadFrom(path);
	}

	async use<T>(key: string, produce: () => T | Promise<T>): Promise<T> {
		switch (this.#mode) {
			case "off":
				return await produce();
			case "record": {
				const v = await produce();
				this.#entries.set(key, v);
				return v;
			}
			case "replay": {
				if (this.#entries.has(key)) {
					return this.#entries.get(key) as T;
				}
				throw new Error(`cassette replay miss for key: ${key}`);
			}
		}
	}

	get mode(): CassetteMode {
		return this.#mode;
	}

	get size(): number {
		return this.#entries.size;
	}

	toData(): CassetteData {
		return {
			version: 1,
			entries: Object.fromEntries(this.#entries),
		};
	}

	save(): void {
		if (!this.#path) return;
		const dir = dirname(this.#path);
		mkdirSync(dir, { recursive: true });
		writeFileSync(this.#path, JSON.stringify(this.toData(), null, "\t"), "utf8");
	}

	static load(path: string, mode: CassetteMode = "replay"): Cassette {
		const c = new Cassette({ path, mode });
		// Force-load entries regardless of mode (replay already loads in constructor;
		// for other modes we load explicitly here so callers always get the stored data).
		if (existsSync(path) && (mode !== "replay" || c.size === 0)) {
			c[LOAD_FROM](path);
		}
		return c;
	}
}
