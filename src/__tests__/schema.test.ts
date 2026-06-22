// src/__tests__/schema.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import { expect, test } from "bun:test";

const schema = JSON.parse(
	readFileSync("schema/saga.schema.json", "utf8"),
);
const ajv = new (Ajv2020 as unknown as typeof import("ajv/dist/2020.js").default)(
	{ strict: false, allErrors: true },
);
const validate = ajv.compile(schema);

const fixturesDir = "examples/tickets/src/__fixtures__";

test("schema declares the base required fields", () => {
	expect(schema.required).toEqual(
		expect.arrayContaining(["saga_id", "duration_days", "events"]),
	);
});

test("all example fixtures validate against the schema", () => {
	const files = readdirSync(fixturesDir).filter((f) =>
		f.endsWith(".saga.yaml"),
	);
	expect(files.length).toBeGreaterThan(0);
	for (const f of files) {
		const doc = parse(readFileSync(join(fixturesDir, f), "utf8"));
		const ok = validate(doc);
		if (!ok) {
			throw new Error(
				`${f} failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
			);
		}
		expect(ok).toBe(true);
	}
});
