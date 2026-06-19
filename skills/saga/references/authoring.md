# Authoring Saga Fixtures

Use this when creating or editing `*.saga.yaml` files.

## Shape

```yaml
saga_id: simple-ticket-resolution
harness_version: 1
duration_days: 3
severity: warning
cast:
  - id: sarah
    display_name: Sarah Chen
    role: Support Engineer
events:
  - at: 2026-06-01T09:00:00Z
    kind: customer_files_ticket
    actor: alex
    subject: Cannot export dashboard
    expected_effects:
      - effect: TicketCreated
        customer: alex
        subject_contains: dashboard
    save:
      ticket_id: effects.TicketCreated[0].id

  - at: 2026-06-02T10:00:00Z
    kind: engineer_reviews
    actor: sarah
    ticket_id: "{{saved.ticket_id}}"
    expected_effects:
      - effect: EngineerApproved
        engineer: sarah
```

## Rules

- Every new fixture should have a single behavioral reason to exist.
- Prefer real workflow language in event payloads, but keep assertions typed.
- Use `save:` for IDs, baselines, or artifacts created in one event and consumed later.
- Keep timestamps deterministic and ordered.
- Include negative-path fixtures for auth, permissions, low confidence, bad data, and rate limits.
- When testing agents, assert effects such as `ResponseDrafted`, `ApprovalRequested`, or `TicketOpened`; avoid asserting exact prose unless the prose is the product contract.

## Save Selectors

Selector grammar:

```text
effects.<EffectKind>[<index>].<field>
```

Example:

```yaml
save:
  approved_doc_id: effects.DocumentApproved[0].id
```

Then reference it later:

```yaml
doc_id: "{{saved.approved_doc_id}}"
```

## Failure Triage

When a fixture fails:

1. Read the missing expected effect and the observed effect list.
2. If present, open the trajectory JSONL file from the failure.
3. Decide whether the fixture, matcher, injector, or product code is wrong.
4. Keep the fix local to the wrong layer.
