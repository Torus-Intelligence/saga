import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { z } from "zod";
import {
	BaseSagaEventSchema,
	BaseSagaManifestSchema,
	MatcherRegistry,
	runSagaCore,
} from "../index.js";

const Effect = z.discriminatedUnion("effect", [
	z.object({
		effect: z.literal("TicketCreated"),
		id: z.string().optional(),
		ticket_id: z.string().optional(),
	}),
]);

const Event = BaseSagaEventSchema.extend({
	kind: z.enum(["create", "use_saved"]),
	expected_effects: z.array(Effect).optional(),
}).passthrough();

const Manifest = BaseSagaManifestSchema.extend({
	events: z.array(Event).min(1),
});

test("save selectors support PascalCase effect names", async () => {
	const dir = await mkdtemp(join(tmpdir(), "saga-runner-"));
	const fixture = join(dir, "pascal-save.saga.yaml");
	await writeFile(
		fixture,
		`
saga_id: pascal-save
harness_version: 1
duration_days: 1
events:
  - at: 2026-06-01T09:00:00Z
    kind: create
    expected_effects:
      - effect: TicketCreated
        id: t-1
    save:
      ticket_id: effects.TicketCreated[0].id
  - at: 2026-06-01T10:00:00Z
    kind: use_saved
    ticket_id: "{{saved.ticket_id}}"
    expected_effects:
      - effect: TicketCreated
        ticket_id: t-1
`,
	);

	const result = await runSagaCore(fixture, {
		manifestSchema: Manifest,
		matchers: new MatcherRegistry(),
		dispatch: async ({ event }) => ({
			observations:
				event.kind === "create"
					? [{ effect: "TicketCreated", payload: { id: "t-1" } }]
					: [
							{
								effect: "TicketCreated",
								payload: { ticket_id: event.ticket_id },
							},
						],
		}),
	});

	expect(result.failed).toEqual([]);
	expect(result.passed).toHaveLength(2);
});
