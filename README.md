# saga-core

Scenario-based testing system for async, multi-agent applications. Hand-authored YAML manifests describe events across days. The runner dispatches each event to your handler, captures the observed effects, and verifies them against the manifest's expected effects.

## Minimal example

```ts
import { z } from "zod";
import {
  BaseSagaManifestSchema,
  MatcherRegistry,
  runSagaCore,
} from "saga-core";

const ManifestSchema = BaseSagaManifestSchema.extend({
  app: z.object({ name: z.string() }),
});

const matchers = new MatcherRegistry().register(
  "ticket_created",
  (expected, obs) => obs.payload.priority === expected.priority,
);

const result = await runSagaCore("./fixtures/simple.saga.yaml", {
  manifestSchema: ManifestSchema,
  matchers,
  dispatch: async ({ event }) => {
    if (event.kind === "customer_files_ticket") {
      const id = await createTicket(event);
      return { observations: [{ effect: "ticket_created", payload: { id, priority: "high" } }] };
    }
    return { observations: [] };
  },
});

console.log(`${result.passed.length}/${result.total_assertions} passed`);
```

## What you get

- **Runner** (`runSagaCore`) -- YAML loader, time-ordered event dispatch, `save:`/`{{saved.*}}` substitution, harness-version gate.
- **Verifier** (`verify`) -- effect matching, surprise detection, typed-outcome support.
- **Trajectory recorder** -- in-memory log with JSONL dump on failure.
- **Outcome adapters** -- fail-stop, auto-PR (LLM-drafted), ticket (Linear/Jira/GitHub Issues), hybrid (severity routing).
- **Persona evolution** -- scrape source interface, logistic-regression discriminator, evolutionary search, materialize-cast helper.

## Extending the schema

Domains supply their own `ExpectedEffect` discriminated union and event-kind enum. `BaseSagaManifestSchema` is a `z.object().passthrough()`, so you can extend safely:

```ts
const MyEffect = z.discriminatedUnion("effect", [
  z.object({ effect: z.literal("ticket_created"), priority: z.string().optional() }),
  z.object({ effect: z.literal("response_sent"), to: z.string().optional() }),
]);

const MyEvent = BaseSagaEventSchema.extend({
  kind: z.enum(["customer_files_ticket", "agent_classifies", "engineer_approves"]),
  expected_effects: z.array(MyEffect).optional(),
});

const MyManifest = BaseSagaManifestSchema.extend({
  events: z.array(MyEvent).min(1),
});
```

## YAML fixture shape

```yaml
saga_id: simple-ticket-resolution
harness_version: 1
duration_days: 3
events:
  - at: 2026-06-01T09:00:00Z
    kind: customer_files_ticket
    actor: alex
    expected_effects:
      - effect: ticket_created
        priority: medium
  - at: 2026-06-01T09:30:00Z
    kind: agent_classifies
    save:
      classified_id: effects.ticket_classified[0].id
  - at: 2026-06-02T10:00:00Z
    kind: engineer_approves
    ticket_id: "{{saved.classified_id}}"
```

## Reference implementation

See `examples/tickets/` for a complete toy customer-support example: in-memory ticket backend, deterministic agent stub, four injectors, seven effect kinds, five saga fixtures.

## Status

Standalone library package. The API is early and expected to change before 1.0.

## Inspirations

- METR -- harness versioning, trajectory log shape
- Pytest-Tavern -- save / template substitution grammar
- WebArena -- typed outcome enums on assertions
- PPol (arxiv 2605.12894) -- behavioral fingerprint + evolutionary persona search
