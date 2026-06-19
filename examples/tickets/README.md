# saga-example-tickets

Reference example for `@torus-oss/saga`. A toy customer-support ticket triage app with multi-step async flows, a tiny agent loop, and five saga fixtures.

Replace the toy backend with your own production code, adapt the injectors to drive your real surfaces, and write your own sagas.

## The toy domain

A customer files a ticket. A classifier agent labels it and drafts a response. A support engineer approves or escalates the draft. The customer sees the response and (sometimes) returns a satisfaction survey.

## Cast

- Sarah Chen, Support Engineer, mornings.
- Marcus Reyes, Senior Support Engineer, escalation owner.
- Alex, Priya, Tom, customer characters.

## Effect taxonomy

- `TicketCreated`
- `TicketClassified`
- `ResponseDrafted`
- `EngineerApprovalRequested`
- `EngineerApproved`
- `EngineerEscalated`
- `ResponseSent`
- `SatisfactionSurveyReceived`

## Sagas

| Fixture | Days | Story |
|---|---|---|
| `simple-ticket-resolution` | 3 | Routine ticket, agent classifies, Sarah approves, customer is happy. |
| `escalation-flow` | 5 | Refund ticket beyond Sarah's budget, escalates to Marcus, resolved on day 4. |
| `low-confidence-classification` | 3 | Agent confidence below threshold, requests engineer help on classification before drafting. |
| `customer-follow-up-arc` | 7 | Ticket resolved on day 2, customer follows up on day 6 with a related question. |
| `agent-misclassifies-then-corrects` | 5 | Agent picks the wrong category on day 1; engineer rejects, agent reclassifies on day 2. |

## Running

```
bun test examples/tickets/src/__tests__/
```

## Layout

```
src/
├── effects/        Effect type declarations + zod schema
├── injectors/      Drive the toy backend on each event kind
├── toy-app/        In-memory backend, deterministic agent loop
├── __fixtures__/   Saga YAML manifests
├── __tests__/      Per-fixture runner tests
└── index.ts        runSaga export
```
