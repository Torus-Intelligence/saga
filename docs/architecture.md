# Saga Architecture & Honest Boundaries

Saga is an **in-process verification oracle**. It loads a YAML manifest of a
user journey, dispatches each event into your real code through injectors,
records observed effects, and verifies them against typed `expected_effects`.

## What Saga does test

- Your application's real backend/dispatch logic in response to a journey:
  state tracking across steps, permission/scope gates, retry/idempotency,
  effect emission, multi-step sequencing.
- Deterministically and fast: no network, no DB, no real clock. Multi-day
  arcs compress to milliseconds because event timestamps are data, not waits.

## What Saga does NOT test (by design)

- **The agent's judgment.** The LLM is not in the loop by default; tool calls
  / classifications are inputs you control. Saga verifies "given decision X,
  does the platform behave correctly," not whether the model chooses X.
- **Real external services.** You assert against your own matchers/injectors.
  If your stub diverges from the real API, Saga can pass while production
  breaks. Fidelity ceiling = honesty of your stubs. Cassettes and the
  production-baseline differential oracle raise that ceiling by sourcing
  inputs from recorded reality instead of imagination.
- **The frontend surfaces.** Events inject at the code level, not via a
  browser.

> **Note on the bundled persona scrape sources.** `LinkedInScrapeSource`,
> `GitHubScrapeSource`, and `ConferenceTalkScrapeSource` return **bundled toy
> data only** — they perform no real scraping or vendor enrichment. The
> credentialed sources throw if marked configured without
> `allow_toy_fallback: true`, so a credential-shaped surface never silently
> returns fake data. Inject your own `PersonaScrapeSource` for real data.

## Oracle, not explorer

Saga is the deterministic gate. Pair it with a live **explorer** — gstack
`/qa`, Playwright, Arga, or your own agent — that drives the real product and
discovers journeys. Crystallize what they find into a `.saga.yaml` with
`fixtureFromTrajectory`, and it becomes a permanent two-second regression gate.

Live-agent and real-browser execution are documented **seams** (see the bundled
skill), intentionally not built into Saga: building them would trade away the
determinism and speed that make Saga worth importing.
