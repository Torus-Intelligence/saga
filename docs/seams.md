# Saga Seams: Live Agent & Browser Surfaces

Saga is a deterministic in-process oracle. By design, it does *not* implement live-agent dispatch or real-browser injection. Instead, it provides two **seams**—intentional extension points—where you wire your own explorers and tool chains to drive real systems, discover journeys, and crystallize them into deterministic fixtures.

## Live-Agent Seam

The `dispatch` function you pass to `runSagaCore` is the live-agent seam:

```ts
export function runDomainSaga(fixturePath: string) {
  return runSagaCore(fixturePath, {
    dispatch: async ({ event }) => {
      // This is the seam. By default, event carries scripted decisions.
      // Wire a real LLM here to make live decisions instead.
      switch (event.kind) {
        case "customer_files_ticket":
          return injectTicketCreated(event);
        case "agent_responds":
          // Seam: instead of scripted tool calls, call your real model
          const decision = await model.invoke({ messages: [...], tools: [...] });
          const toolCalls = decision.tool_calls;
          // Map the agent's tool calls and outputs into observed effects
          return { observations: toolCallsToEffects(toolCalls) };
        default:
          return { observations: [] };
      }
    },
  });
}
```

**What happens:** Your real LLM or agent receives the event's context (messages, tools, history). It makes live decisions—tool calls, classifications, responses. You then map those outputs into the observed effects that Saga's matchers will compare against `expected_effects`.

**Trade-off:** This run is non-deterministic. Keep it out of your default CI lane. Use it to explore and debug agent behavior in staging, then freeze the learned journeys into deterministic fixtures for the regression suite.

## Browser-Surface Seam

A browser-surface seam is an **injector function** that drives the real frontend and translates UI/network state into observed effects:

```ts
async function injectorBrowserTicketCreation(event: Event): Promise<Observation[]> {
  // Seam: open Chromium, navigate, perform the user action, observe the result
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Set up cassette to intercept network calls (see below)
  const cassette = new Cassette({ mode: "replay", path: "./cassettes/dashboard.yaml" });
  await cassette.intercept(page);
  
  // Drive the UI
  await page.goto("https://app.example.com");
  await page.fill('input[name="subject"]', event.subject);
  await page.click('button[type="submit"]');
  
  // Translate UI/network state into effects
  const ticket = await page.textContent(".ticket-id");
  await browser.close();
  
  return [{
    effect: "TicketCreated",
    payload: { id: ticket },
  }];
}
```

**What happens:** The injector launches Chromium/Playwright, drives real browser actions, and observes the resulting UI state and network calls. It translates that into effects.

**Determinism via cassettes:** Pair the injector with a `Cassette` to intercept and replay HTTP traffic. First run records real responses; subsequent runs replay them deterministically, keeping network non-determinism out of your CI without sacrificing fidelity.

```ts
const cassette = new Cassette({ 
  mode: "replay",
  path: "./cassettes/dashboard.yaml" 
});
await cassette.intercept(page);
// Now page.goto() and all fetch/XHR calls use recorded responses
```

## Explorers → Fixtures → Oracle

The journey is:

1. **Explorer** (gstack `/qa`, Playwright, Arga, a real agent, or manual testing) discovers how your product should behave end-to-end.
2. **Crystallize** the discovered journey with `fixtureFromTrajectory(snapshot)` or `fixtureFromTrajectoryJsonl(jsonl)`, which produces a `.saga.yaml`.
3. **Oracle** (Saga) runs the fixture deterministically in CI, fast and repeatably. Expected effects are the specification; observed effects are the implementation's answer.

Saga itself is *not* the explorer. It is the **gate**—the deterministic verification oracle you invoke after human or external-agent exploration has found what matters.

Live-agent and real-browser seams exist at the boundary where you wire your explorers. Build them if you need them; Saga deliberately does not, because shipping them would trade away the determinism and speed that make Saga worth the import.
