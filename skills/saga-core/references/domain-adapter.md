# Domain Adapter Pattern

Use this when wiring Saga to a new app or workflow domain.

## Minimal Adapter

```ts
import {
  BaseSagaEventSchema,
  BaseSagaManifestSchema,
  MatcherRegistry,
  runSagaCore,
} from "saga-core";
import { z } from "zod";

const Effect = z.discriminatedUnion("effect", [
  z.object({
    effect: z.literal("TicketCreated"),
    customer: z.string().optional(),
  }),
]);

const Event = BaseSagaEventSchema.extend({
  kind: z.enum(["customer_files_ticket"]),
  expected_effects: z.array(Effect).optional(),
}).passthrough();

const Manifest = BaseSagaManifestSchema.extend({
  events: z.array(Event).min(1),
});

const matchers = new MatcherRegistry().register("TicketCreated", (expected, observed) => {
  if (expected.customer !== undefined && observed.payload.customer !== expected.customer) {
    return false;
  }
  return true;
});

export function runDomainSaga(path: string) {
  return runSagaCore(path, {
    manifestSchema: Manifest,
    matchers,
    dispatch: async ({ event }) => {
      switch (event.kind) {
        case "customer_files_ticket":
          return injectTicketCreated(event);
        default:
          return { observations: [] };
      }
    },
  });
}
```

## Layering

- Event schema: describes inputs in the fixture.
- Effect schema: describes outputs that can be asserted.
- Injector: calls real app functions with DI stubs.
- Matcher: compares expected effect fields with observed effect payloads.
- Runner test: points at a fixture and asserts all expected effects pass.

## DI Rules

- Stub nondeterministic boundaries: LLMs, time, network, git hosts, ticket trackers, databases.
- Keep product logic real where possible.
- Prefer dependency parameters or test setters over module-level monkeypatching.
- Never call live APIs in default tests.

## Matcher Rules

- Match only fields specified by the fixture.
- Use typed enums for outcomes: `SUCCESS`, `NOT_FOUND`, `PERMISSION_DENIED`, `DATA_VALIDATION_ERROR`, `RATE_LIMITED`.
- Add a matcher before weakening a fixture assertion.
- Treat surprise effects as useful signal unless the domain intentionally emits noisy telemetry.
