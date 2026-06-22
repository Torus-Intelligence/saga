// scripts/gen-saga-schema.ts
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { BaseSagaManifestSchema } from "../src/types.ts";

// zod v4 native JSON Schema export.
const schema = z.toJSONSchema(BaseSagaManifestSchema, {
	target: "draft-2020-12",
}) as Record<string, unknown>;

schema.$id = "https://torus-oss.github.io/saga/saga.schema.json";
schema.title = "Saga Manifest";
schema.description =
	"Generic Saga manifest. Domains extend this with their own event kinds and expected_effect shapes.";

writeFileSync(
	"schema/saga.schema.json",
	`${JSON.stringify(schema, null, "\t")}\n`,
	"utf8",
);
console.log("wrote schema/saga.schema.json");
