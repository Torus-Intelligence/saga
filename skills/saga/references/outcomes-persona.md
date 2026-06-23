# Outcomes And Persona Simulation

Use this when configuring failure routing or synthetic client simulation.

## Outcome Adapters

Saga can route failed verdicts through adapters:

- `fail-stop`: throw a structured assertion error and stop.
- `auto-pr`: ask a pluggable LLM drafter for a patch plan and open a draft PR through a pluggable git host client.
- `ticket`: open a Linear, Jira, or GitHub Issues ticket through a pluggable client.
- `hybrid`: route by severity.

Default tests should use `fail-stop` or stubbed clients. Do not configure live tracker or git-host credentials in tests.

## Failure Record

Outcome adapters should receive:

- saga id
- fixture path
- event index
- expected effect
- observed effects
- miss reason
- trajectory path, when available
- severity, when configured

The adapter should be a side-effect boundary. Keep verification deterministic before the adapter runs.

## Persona Modules

The persona surface is optional and generic:

- `scrape`: collect source profiles through pluggable adapters. The bundled LinkedIn/GitHub/Conference sources return toy data only and throw when marked configured without `allow_toy_fallback: true`; inject your own `PersonaScrapeSource` for real data.
- `fingerprint`: convert profiles or utterances into domain dimensions.
- `discriminator`: score real-vs-synthetic separation with the logistic-regression baseline.
- `evolve`: generate and mutate synthetic personas against the discriminator and coverage goals.

Consumers define their own dimensions. Do not ship private customer dimensions in Saga.

## Persona Quality Checks

- Check representativeness: source profiles should cover the roles being simulated.
- Preserve variance: do not optimize into a single average persona.
- Track dimension spread per generation.
- Use personas to improve fixture realism, not to claim production validation.
