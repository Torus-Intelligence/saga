# Saga Fidelity: Fixtures, Cassettes & Oracles

Use this reference when implementing deterministic verification with Saga: crystallizing discovered journeys into fixtures, controlling external APIs with cassettes, and comparing actual behavior against golden baselines.

**Invariant:** All of these are opt-in. The default Saga run stays deterministic—no network, no real clock, ~2 seconds.

---

## 1. Crystallizing Journeys: Fixtures from Trajectories

When an explorer (real agent, Playwright, gstack `/qa`) discovers a journey, crystallize it into a deterministic fixture:

```ts
import { fixtureFromTrajectory, fixtureFromTrajectoryJsonl } from "@torus-oss/saga";

// From a snapshot object (e.g., captured by an explorer)
const snapshot = {
  saga_id: "agent_helps_customer",
  cast: [{ id: "agent", display_name: "Support Bot" }],
  events: [/* ... */],
};
const fixture = fixtureFromTrajectory(snapshot);
// fixture is a `.saga.yaml` string; write it to disk

// Or from a JSONL trajectory file (one JSON object per line)
const fixture = await fixtureFromTrajectoryJsonl("./trajectory.jsonl");
```

Both functions return a YAML string ready to save as `*.saga.yaml`. Once crystallized, run it deterministically in CI with `runSagaCore`.

---

## 2. Cassettes: Recording & Replaying External APIs

A `Cassette` records real API responses on first run and replays them deterministically after, keeping network calls out of CI without sacrificing fidelity.

### Modes

- **`record`**: Capture real responses; create or update the cassette file.
- **`replay`**: Use recorded responses; fail if a request is not found in the cassette.
- **`off`**: No cassette; live API calls (use only in live exploratory runs, not CI).

### Usage

```ts
import { Cassette } from "@torus-oss/saga";
import { Cassette as GithubCassette } from "@torus-oss/saga/twins/github";
import { Cassette as SlackCassette } from "@torus-oss/saga/twins/slack";

// Create a cassette
const cassette = new Cassette({
  mode: "replay",  // or "record" on first run
  path: "./cassettes/dashboard-creation.yaml",
});

// Use it to record/replay a request
const response = cassette.use("fetch-user-profile", async () => {
  // First run: makes real HTTP request, records response
  // Subsequent runs: returns recorded response
  return fetch("https://api.example.com/user/123").then(r => r.json());
});

// Save the cassette after recording
await cassette.save();

// Load a cassette from disk
const loaded = await Cassette.load("./cassettes/dashboard-creation.yaml");
```

### Reference Twins

Pre-built cassettes for common services (GitHub, Slack, Stripe):

```ts
const githubCassette = new GithubCassette({
  mode: "replay",
  owner: "torus-oss",
  repo: "saga",
});

const slackCassette = new SlackCassette({
  mode: "replay",
  team: "my-workspace",
});

// Use them to intercept API calls
const ghResponse = githubCassette.use("list-issues", () => 
  fetch("https://api.github.com/repos/torus-oss/saga/issues")
);
```

Control cassette mode via environment variable:

```bash
SAGA_CASSETTE_MODE=record npm test
SAGA_CASSETTE_MODE=replay npm test  # default
```

---

## 3. Differential Oracle: Comparing Against Baseline

Compare an actual run's effect stream against a recorded golden trajectory, ignoring volatile fields (ids, timestamps):

```ts
import { diffTrajectories, assertAgainstBaseline } from "@torus-oss/saga";

// Run the actual journey and capture its trajectory
const actualTrajectory = await runSagaCore("./fixture.saga.yaml", { /* ... */ });

// Load a baseline (recorded golden run)
const baseline = JSON.parse(
  fs.readFileSync("./baselines/ticket-resolution.json", "utf-8")
);

// Compare, ignoring volatile fields
const diff = diffTrajectories(baseline, actualTrajectory, {
  ignoreFields: ["id", "created_at", "updated_at", "request_id"],
});

if (diff.length > 0) {
  console.error("Differences found:", diff);
  // diff is an array of { event_index, path, expected, actual }
}

// Or assert directly (throws if diff found)
assertAgainstBaseline(actualTrajectory, baseline);
```

Use this to:
- Lock down the observable behavior of your core workflow.
- Detect unintended behavior changes across refactors.
- Compare staging runs against production baselines.

---

## 4. Seams: Live-Agent & Browser Injection

Saga deliberately does not implement live LLM dispatch or real-browser injection. Instead, it provides seams where you wire your own explorers.

**Live-agent seam:** the `dispatch` function you pass to `runSagaCore`:

```ts
runSagaCore(path, {
  dispatch: async ({ event }) => {
    if (event.kind === "agent_decides") {
      // Seam: call your real LLM here (makes the run non-deterministic)
      const decision = await model.invoke(event.prompt);
      return { observations: parseDecisionToEffects(decision) };
    }
    return injectScriptedEvent(event);
  },
});
```

**Browser-surface seam:** an injector that drives Playwright/Chromium:

```ts
async function browserInjector(event) {
  const cassette = new Cassette({ mode: "replay", path: "./cassettes/ui.yaml" });
  const page = await chromium.newPage();
  await cassette.intercept(page);  // Pair with cassettes for determinism
  
  await page.goto("https://app.example.com");
  await page.fill('input[name="email"]', event.email);
  await page.click('button[type="submit"]');
  
  return [{ effect: "TicketCreated", payload: { id: ... } }];
}
```

Both are **documented but not built into Saga**. Build them if you need them; Saga's job is the deterministic oracle, not the explorer. See [`docs/seams.md`](../../docs/seams.md) for the full pattern.

---

## Summary

| Concept | Purpose | Opt-in? |
|---------|---------|---------|
| `fixtureFromTrajectory(snapshot)` | Crystallize discovered journey → deterministic fixture | Yes |
| `Cassette(mode, path)` | Record/replay external APIs deterministically | Yes |
| `diffTrajectories(baseline, actual, {ignoreFields})` | Compare runs, ignoring volatile fields | Yes |
| `assertAgainstBaseline(actual, baseline)` | Assert run matches golden baseline | Yes |
| Live-agent seam (`dispatch` function) | Wire real LLM; makes run non-deterministic | Yes |
| Browser seam (Playwright injector) | Drive real frontend; pair with cassettes | Yes |

Default Saga run: no network, ~2 seconds, fully deterministic. All fidelity features remain opt-in.
