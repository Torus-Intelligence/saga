---
name: saga
description: Author, adapt, and run Saga scenario tests for backend or agent workflows using @torus-oss/saga. Use when Codex needs to add or debug YAML Saga fixtures, wire event injectors to production code through DI, define typed effect matchers, inspect trajectory failures, configure fail-stop/auto-PR/ticket outcome adapters, or add persona simulation with scrape/fingerprint/discriminator/evolve modules.
---

# Saga

Saga is a small dev-tool harness for multi-step workflow tests. It loads YAML scenarios, dispatches events into the user's real code through injectors, records observed effects, verifies them with typed matchers, and can route failures to fail-stop, auto-PR, or ticket adapters.

## Mental model: oracle, not explorer

Saga is the deterministic verification oracle. The default run is in-process,
makes no network calls, and finishes in ~2s. It tests the platform's real
logic in response to a journey — not the agent's judgment and not the
frontend. Pair it with a live explorer (gstack /qa, Playwright, Arga, your own
agent) that discovers journeys, then crystallize their recorded run into a
fixture with `fixtureFromTrajectory` / `fixtureFromTrajectoryJsonl`.

Fidelity ladder (all opt-in, default stays deterministic):
1. Authored fixtures (default).
2. Cassettes — replay recorded real responses for stubbed boundaries.
3. Production-baseline differential oracle — diff a run against a recorded
   golden trajectory.

Live-agent and real-browser execution are seams, not built in — wire your own.

## Core Workflow

1. Inspect the existing Saga surface before editing:
   - Library repo: `src/`, `README.md`, `examples/tickets/`.
   - Consumer repo: search for `runSagaCore`, `MatcherRegistry`, `expected_effects`, and `*.saga.yaml`.
2. Identify the domain boundary:
   - Keep Saga generic.
   - Put domain event schemas, effect schemas, matchers, and injectors in the consumer package.
   - Drive real application functions through DI stubs; do not mock the Saga runner itself.
3. Add or update the fixture:
   - Use `harness_version: 1`.
   - Use named cast and time-ordered events.
   - Assert typed `expected_effects`.
   - Use `save:` plus `{{saved.name}}` for cross-event continuity.
4. Wire the domain adapter:
   - Extend `BaseSagaEventSchema` and `BaseSagaManifestSchema`.
   - Register matchers with `MatcherRegistry`.
   - Implement `dispatch` by switching on `event.kind` and calling injectors.
5. Run the narrow fixture test first, then the full Saga suite. Before shipping, run the complete gate with `bun run ci` (typecheck, unit tests, example tests, dist smoke, pack dry-run).
6. If a failure is non-obvious, inspect the trajectory JSONL path in the failure and work from the observed effects, not assumptions.

## References

- Read `references/authoring.md` when creating or revising `*.saga.yaml` fixtures.
- Read `references/domain-adapter.md` when wiring a new event/effect taxonomy or injectors.
- Read `references/outcomes-persona.md` when configuring failure routing or persona simulation.

## Guardrails

- Do not put customer-specific, company-specific, or internal-domain effect types in Saga.
- Do not require live external services in default tests. Use DI stubs for LLMs, databases, trackers, and git hosts.
- Do not use broad string matching when a typed effect matcher can make the assertion precise.
- Do not treat a Saga passing as real-world validation. Saga is the pre-human gate; production signal belongs in the consumer's validation or graduation system.
- Prefer adding a small focused fixture over enlarging one fixture until it becomes hard to debug.
