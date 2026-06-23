# Changelog

All notable changes to `@torus-oss/saga` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-06-23

### Fixed

- **Trajectory seed** is now a real resolved seed (explicit option →
  `SAGA_SEED` env → random), recorded in the trajectory header and passed to
  `dispatch` as `DispatchArgs.seed`. It was previously hardcoded to `0`.
- **Persona scrape sources** (`LinkedInScrapeSource`, `GitHubScrapeSource`)
  now throw when marked configured without `allow_toy_fallback: true`, instead
  of silently returning bundled toy data. Corrected the misleading
  "wires Clay/Apollo/ZoomInfo" comment and documented the toy-only behavior in
  `docs/architecture.md`.

## [0.1.0] - 2026-06-23

### Added

- **`fixtureFromTrajectory` / `fixtureFromTrajectoryJsonl`** — crystallize a
  recorded run into a `.saga.yaml` fixture (the oracle/explorer bridge).
- **Cassettes** — `Cassette` record/replay primitive (`SAGA_CASSETTE_MODE`)
  plus GitHub / Slack / Stripe reference twins exported from
  `@torus-oss/saga/twins`.
- **Production-baseline differential oracle** — `diffTrajectories` /
  `assertAgainstBaseline`, comparing a run's effect stream against a recorded
  golden trajectory with volatile-field normalization.
- **Generic JSON Schema** for `.saga.yaml`, generated from the zod manifest
  schema and shipped in the package.
- Honest "what Saga does / does not test" architecture doc, a fidelity
  reference, and live-agent / browser seam docs.
- Claude Code plugin manifest for installing the bundled skill.

## [0.0.1] - 2026-06-19

### Added

- Initial public release: YAML scenario runner, typed verifier, trajectory
  recorder, outcome adapters (fail-stop / auto-PR / ticket / hybrid), and
  persona modules (scrape / fingerprint / discriminator / evolve).
