# Contributing

This project is early. Keep changes small, typed, and covered by examples.

## Setup

```bash
bun install
bun run typecheck
bun run test
bun run test:examples
```

## Guidelines

- Keep `src/` domain-neutral.
- Put realistic workflow examples under `examples/`, not in the core library.
- Add or update a saga fixture when behavior changes.
- Use dependency injection for external systems in tests.
- Do not add live-service requirements to default tests.
- Keep README examples runnable or clearly marked as sketches.

## Pull Requests

Include:

- what changed;
- why it belongs in the generic library or example;
- test commands run;
- any API compatibility notes.
